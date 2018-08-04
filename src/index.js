require("babel-polyfill")

const trezor = require('trezor.js')
const readline = require('readline')
const Writable = require('stream').Writable
const process = require('process')
const btc = require('bitcoinjs-lib')
const bsk = require('blockstack')

const debug = true

// DeviceList encapsulates transports, sessions, device enumeration and other
// low-level things, and provides easy-to-use event interface.
const list = new trezor.DeviceList()

const DO_CACHE_PASSPHRASE = true

const payerPath = `m/44'/5757'/0'/0/0`
const ownerPath = `m/88'/1'/0'/0/0`

let ADDRESS_MAP = {}
let PASSPHRASE_CACHE = false

let KNOWN_TX_MAP = {}

function translateInput(input) {
  const script_sig = input.hash.length > 0 ? input.script.toString('hex') : null
  return {
    prev_index: input.index,
    prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
    script_sig
  }
}

class TrezorSigner {

  constructor(device, hdpath, address) {
    this.address = address
    this.hdpath = hdpath
    this.device = device
  }

  static createSigner(device, hdpath) {
    return getAddressFrom(device, hdpath)
      .then(address => new TrezorSigner(device, hdpath, address))
  }

  getAddress() {
    return Promise.resolve(this.address)
  }

  signTransaction(txB, signInputIndex) {
    let info = { inputs: null, outputs: null }
    return Promise.resolve()
      .then(() => {
        // we need to do a _lot_ of garbage here.
        // Step 1: make TxInfo object
        const inputs = txB.__tx.ins
              .map( (input, inputIndex) => {
                const translated = translateInput(input)
                if (inputIndex === signInputIndex) {
                  translated.address_n = pathToPathArray(this.hdpath)
                }
                return translated
              })
        const outputs = txB.__tx.outs
              .map( output => {
                if (btc.script.toASM(output.script).startsWith('OP_RETURN')) {
                  const nullData = btc.script.decompile(output.script)[1]
                  return { op_return_data: nullData.toString('hex'),
                           amount: 0,
                           script_type: 'PAYTOOPRETURN' }
                } else {
                  const address = bsk.config.network.coerceAddress(
                    btc.address.fromOutputScript(output.script))
                  return { address,
                           amount: output.value,
                           script_type: 'PAYTOADDRESS' }
                }
              })

        info.inputs = inputs
        info.outputs = outputs

        // Step 2: now we need to fetch the referrant TXs
        const referrants = []
        inputs.forEach( input => {
          const txid = input.prev_hash
          if (referrants.indexOf(txid) < 0) {
            referrants.push(txid)
          }
        })

        const referrantPromises = referrants.map(
          hash => getTransaction(hash)
            .then(rawTx => btc.Transaction.fromBuffer(rawTx))
            .then(transaction => {
              return {
                version: transaction.version,
                locktime: transaction.locktime,
                hash: transaction.getId(),
                inputs: transaction.ins.map(translateInput),
                bin_outputs: transaction.outs.map(output => {
                  return {
                    amount: output.value,
                    script_pubkey: output.script.toString('hex')
                  }
                }),
                extra_data: null
              }
            }))

        return Promise.all(referrantPromises)
      })
      .then((referrants) => {
        const coinName = getCoinName()
        return this.device.waitForSessionAndRun((session) =>
                                                session.signTx(info.inputs, info.outputs, referrants,
                                                               coinName))
          .then(resp => resp.message.serialized.serialized_tx)
      })
      .then((signedTxHex) => {
        // god of abstraction, forgive me, for I have transgressed
        const signedTx = btc.Transaction.fromHex(signedTxHex)
        const signedTxB = btc.TransactionBuilder.fromTransaction(signedTx)
        txB.__inputs[signInputIndex] = signedTxB.__inputs[signInputIndex]
      })
  }

  signerVersion() {
    return 1
  }
}

function getCoinName() {
  const network = bsk.config.network.layer1
  if (network.pubKeyHash === 0) {
    return 'bitcoin'
  } else if (network.pubKeyHash === 111) {
    return 'testnet'
  }
  throw new Error('Unknown layer 1 network')
}

function getTransaction (txId) {
  if (txId in KNOWN_TX_MAP) {
    return Promise.resolve(Buffer.from(
      KNOWN_TX_MAP[txId], 'hex'))
  }
  if (getCoinName() === 'testnet') {
    return getTransactionBitcoind(txId)
  }

  const apiUrl = `https://blockchain.info/rawtx/${txId}?format=hex`
  return fetch(apiUrl)
    .then(x => {
      if (!x.ok) {
        throw new Error('failed to get raw TX')
      }
      return x.text()
    })
    .then(x => Buffer.from(x, 'hex'))
}

function getTransactionBitcoind (txId) {
  const bitcoindUrl = bsk.config.network.btc.bitcoindUrl
  const bitcoindCredentials = bsk.config.network.btc.bitcoindCredentials

  const jsonRPC = {
    jsonrpc: '1.0',
    method: 'getrawtransaction',
    params: [txId]
  }

  const authString = Buffer.from(`${bitcoindCredentials.username}:${bitcoindCredentials.password}`)
      .toString('base64')
  const headers = { Authorization: `Basic ${authString}` }
  return fetch(bitcoindUrl, {
    method: 'POST',
    body: JSON.stringify(jsonRPC),
    headers
  })
    .then(resp => resp.json())
    .then(json => Buffer.from(json.result, 'hex'))
}

function pathToPathArray (path) {
  const harden = 0x80000000
  let pieces = path.split('/')
  if (pieces.length === 1) {
    let inferred
    if (path.startsWith('0x')) {
      console.log(`Trying to look up address: ${path}`)
      const addr = path.toLowerCase()
      if (addr in ADDRESS_MAP) {
        inferred = ADDRESS_MAP[addr]
      } else {
        throw new Error(`Could not find ${path} in dictionary. Have you called "loadaddrs"?`)
      }
    } else {
      inferred = `m/44'/60'/0'/0/${path}`
    }
    console.log(`Using derivation path: ${inferred}`)
    pieces = inferred.split('/')
  }
  if (pieces[0] !== 'm') {
    throw new Error(`Invalid path ${path}`)
  }
  return pieces
    .slice(1)
    .map(x => {
      if (x.endsWith('\'')) {
        return (parseInt(x.slice(0)) | harden) >>> 0
      } else {
        return parseInt(x)
      }
    })
}

function getAddressFrom (device, hdpath) {
  return device.waitForSessionAndRun((session) => {
    let hdPathArray = pathToPathArray(hdpath)
    return session.getAddress(hdPathArray, getCoinName(), false)
  })
    .then(response => response.message.address)
}

function doGetAddressInfo(device, hdpath) {
  return getAddressFrom(device, hdpath)
    .then((address) => {
      console.log(`Address = ${address}`)
    })
}

function paddedHex(number) {
  let result = number.toString(16)
  if (result.length % 2 !== 0) {
    return `0${result}`
  } else {
    return result
  }
}

function setRegtest () {
  bsk.config.network = bsk.network.defaults.LOCAL_REGTEST
}

function doMakePreorder (device, name, destination) {
  return TrezorSigner.createSigner(device, payerPath)
    .then((txSigner) =>
      bsk.transactions.makePreorder(name, destination, txSigner)
          .then(rawTX => {
            console.log('=== PREORDER TX ===')
            console.log(rawTX)
            bsk.config.network.modifyUTXOSetFrom(rawTX)
            const txid = btc.Transaction
                  .fromHex(rawTX).getHash().reverse().toString('hex')
            KNOWN_TX_MAP[txid] = rawTX
            return bsk.config.network.broadcastTransaction(rawTX)
          }))
    .then(() => doMakeRegister(device, name, destination))
}

function doMakeRegister (device, name, destination) {
  const zonefile = `$ORIGIN ${name}
$TTL 3600
_http._tcp URI 10 1 "https://gaia.blockstacktest.org/hub/${destination}/profile.json"`

  return TrezorSigner.createSigner(device, payerPath)
    .then((txSigner) =>
      bsk.transactions.makeRegister(name, destination, txSigner, zonefile)
          .then(rawTX => {
            console.log('=== REGISTER TX ===')
            console.log(rawTX)
            bsk.config.network.modifyUTXOSetFrom(rawTX)
            const txid = btc.Transaction
                  .fromHex(rawTX).getHash().reverse().toString('hex')
            KNOWN_TX_MAP[txid] = rawTX
            return bsk.config.network.broadcastTransaction(rawTX)
          }))
}

function doMakeUpdate (device, name, zonefile) {
  return TrezorSigner.createSigner(device, payerPath)
    .then(payerSigner =>
          TrezorSigner.createSigner(device, ownerPath)
          .then(ownerSigner =>
                bsk.transactions.makeUpdate(name, ownerSigner, payerSigner, zonefile)
                .then(rawTX => {
                  console.log('=== UPDATE TX ===')
                  console.log(rawTX)
                  bsk.config.network.modifyUTXOSetFrom(rawTX)
                  const txid = btc.Transaction
                        .fromHex(rawTX).getHash().reverse().toString('hex')
                  KNOWN_TX_MAP[txid] = rawTX
                  return bsk.config.network.broadcastTransaction(rawTX)
                })))
}

function promptCompleter(line) {
  const completions = 'make-register get-addr set-reg-test make-update'.split(' ')
  const hits = completions.filter((c) => c.startsWith(line))
  // show all completions if none found
  return [hits.length ? hits : completions, line]
}

function startCommandLine(trezorSession, showCommands) {
  if (showCommands) {
    console.log('')
    console.log('Blockstack trezor wallet interactions')
    if (DO_CACHE_PASSPHRASE) {
      console.log('')
      console.log('WARNING: currently configured to cache the "passphrase" in memory so it doesnt prompt on every trezor operation.')
      console.log('')
    }
    console.log('Commands supported: ')
    console.log('')
    console.log('set-reg-test')
    console.log('make-register <name> <destination-address>')
    console.log('make-update <name> <zonefile>')
    console.log('get-addr <payer|owner>')
    console.log('')
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: promptCompleter,
  })


  rl.question("> ", function (line) {
    rl.close()
    let command = line.trim().split(' ')
    if (command[0] == 'make-register') {
      return doMakePreorder(trezorSession, command[1], command[2])
        .catch((err) => {
          console.log(err)
          console.log('ERROR OCCURRED IN LAST COMMAND.')
        })
        .then(() => startCommandLine(trezorSession))
    } else if (command[0] == 'make-update') {
      return doMakeUpdate(trezorSession, command[1], command[2])
        .catch((err) => {
          console.log(err)
          console.log('ERROR OCCURRED IN LAST COMMAND.')
        })
        .then(() => startCommandLine(trezorSession))
    } else if (command[0] == 'set-reg-test') {
      setRegtest()
      return startCommandLine(trezorSession)
    } else if (command[0] == 'get-addr') {
      let path = payerPath
      if (command[1] === 'owner') {
        path = ownerPath
      }
      return doGetAddressInfo(trezorSession, path)
        .catch((err) => {
          console.log(err)
          console.log('ERROR OCCURRED IN LAST COMMAND.')
        })
        .then(() => startCommandLine(trezorSession))
    } else {
      return startCommandLine(trezorSession)
    }
  })
}

list.on('connect', function (device) {
  if (debug) {
    console.log('Devices:', list.asArray().map(x => x.features.label))
  }
  console.log('')
  console.log("Connected to device " + device.features.label);
  console.log('')

  // What to do on user interactions:
  device.on('button', function(code) { buttonCallback(device.features.label, code); });
  device.on('passphrase', passphraseCallback);
  device.on('pin', pinCallback);

  // For convenience, device emits 'disconnect' event on disconnection.
  device.on('disconnect', function () {
    console.log('Disconnected the opened device. Cowardly exiting.');
    process.exit()
  })

  // You generally want to filter out devices connected in bootloader mode:
  if (device.isBootloader()) {
    throw new Error('Device is in bootloader mode, re-connected it');
  }

  if (debug) {
    console.log("Trezor session initialized")
    console.log('')
  }

  startCommandLine(device, true)
})

// Note that this is a bit duplicate to device.on('disconnect')
list.on('disconnect', function (device) {
  console.log("Disconnected device " + device.features.label);
});

// This gets called on general error of the devicelist (no transport, etc)
list.on('error', function (error) {
  console.error('List error:', error);
});

// On connecting unacquired device
list.on('connectUnacquired', function (device) {
  askUserForceAcquire(function() {
    device.steal().then(function() {
    });
  });
});

function askUserForceAcquire(callback) {
  return setTimeout(callback, 1000);
}

/**
 * @param {string}
 */
function buttonCallback(label, code) {
}


function hiddenQuestion(query, callback) {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  var stdin = process.openStdin()

  const onDataHandler = function(char) {
    char = char + "";
    switch (char) {
    case "\n":
    case "\r":
    case "\u0004":
      stdin.removeListener("data",onDataHandler)
      break;
    default:
      process.stdout.write("\x1b[2K\x1b[200D" + query + Array(rl.line.length+1).join("*"));
      break;
    }
  }

  process.stdin.on("data", onDataHandler)

  rl.question(query, function(value) {
    rl.history = rl.history.slice(1);
    rl.close()
    callback(value);
  });
}

function passphraseCallback(callback) {
  if (DO_CACHE_PASSPHRASE && PASSPHRASE_CACHE !== false) {
    callback(null, PASSPHRASE_CACHE)
    return
  }

  console.log('Please enter passphrase.');

  hiddenQuestion("?> ", function (line) {
    let pinCode = line.trim()
    if (DO_CACHE_PASSPHRASE) {
      PASSPHRASE_CACHE = pinCode
    }
    callback(null, pinCode)
  })
}

/**
 * @param {string} type
 * @param {Function<Error, string>} callback
 */
function pinCallback(type, callback) {
  console.log('Please enter PIN.');
  console.log('Key in numbers from grid below, corresponding to your pin on device:')
  console.log('')
  console.log('7 8 9')
  console.log('4 5 6')
  console.log('1 2 3')

  hiddenQuestion("?> ", function (line) {
    let pinCode = line.trim()
    callback(null, pinCode)
  })
}

// you should do this to release devices on exit
process.on('exit', function() {
    list.onbeforeunload();
})

