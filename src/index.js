import { DeviceList } from 'trezor.js'
import btc from 'bitcoinjs-lib'
import readline from 'readline'
import process from 'process'
import { TrezorMultiSigner } from './TrezorMultiSigSigner'
import BigInteger from 'bigi'

const bsk = require('blockstack')

import { pathToPathArray, getCoinName, trackTransaction } from './utils'
import { TrezorSigner } from './TrezorSigner'
import { NullSigner } from './NullSigner'

//const TESTNET = 'testnet.blockstack.org'
const TESTNET = 'localhost'
const debug = true

// DeviceList encapsulates transports, sessions, device enumeration and other
// low-level things, and provides easy-to-use event interface.
const list = new DeviceList()

const DO_CACHE_PASSPHRASE = true

const payerPath = `m/44'/5757'/0'/0/0`
const payerPath1 = `m/44'/5757'/0'/0/1`
const payerPath2 = `m/44'/5757'/0'/0/2`
const payerPath3 = `m/44'/5757'/0'/0/3`
const ownerPath = `m/88'/1'/0'/0/0`

const REGTEST_FUNDER = 'bb68eda988e768132bc6c7ca73a87fb9b0918e9a38d3618b74099be25f7cab7d01'
const FUNDER_KEY = 'b94e0a49f76b605b37508a8dd7ed465aac4591d57993abe2f286421e35f1dcd901'

let PASSPHRASE_CACHE = false

let PAYER_ADDRESS = false

let FUNDER_ADDRESS = false

function getTrezorSignerMultisig(device, path, signatures) {
  if (!signatures) {
    signatures = ['','','']
  }
  return TrezorMultiSigner.createSigner(device, path,
                                        [payerPath1, payerPath2, payerPath3],
                                        2, signatures)
}

function signTransactionMore(device, txHex, path, inputN, signedBy) {
  const tx = btc.Transaction.fromHex(txHex)
  const TxB = btc.TransactionBuilder.fromTransaction(tx)

  let existingSignatures = []
  let sigHashType

  if (tx.ins[inputN].script.length > 0) {
    const decompiledInput = btc.script.decompile(tx.ins[inputN].script)
    if (decompiledInput[0] !== 0) {
      throw new Error('Unexpected input format! Must be standard multisig.')
    }
    existingSignatures = decompiledInput.slice(1, -1)
      .map(buff => {
        if (buff === 0) {
          return null
        } else {
          const hexSig = buff.toString('hex')
          if (! sigHashType) {
            sigHashType = hexSig.slice(-2)
          } else if (sigHashType !== hexSig.slice(-2)) {
            throw new Error('Non-matching sig-hash-types in the signatures!')
          }
          return hexSig.slice(0, -2) // remove sig-hash-type byte.
        }
      })
      .filter(x => x !== null)
  }
  let currentIndex = 0
  const signatures = signedBy.map(wasSigned => {
    if (wasSigned === 0) {
      return ''
    } else {
      const rVal = existingSignatures[currentIndex]
      currentIndex += 1
      return rVal
    }
  })

  return getTrezorSignerMultisig(device, path, signatures)
    .then(txSigner => txSigner.signTransaction(TxB, inputN))
    .then(() => {
      const tx = TxB.build().toHex()
      console.log('== SIGNED TX ==')
      console.log(tx)
      return tx
    })
}

function doGetAddressInfo(device, hdpath) {
  return TrezorSigner.getAddressFrom(device, hdpath)
    .then((address) => {
      console.log(`Address = ${address}`)
    })
}

function setRegtest (device, broadcastSpend) {
  bsk.config.network = bsk.network.defaults.LOCAL_REGTEST
  // return TrezorSigner.getAddressFrom(device, payerPath)
  //  .then((address) =>

  return getTrezorSignerMultisig(device)
    .then((signer) => signer.getAddress()
          .then((payerAddress) =>
                { PAYER_ADDRESS = payerAddress
                  FUNDER_ADDRESS = bsk.ecPairToAddress(bsk.hexStringToECPair(FUNDER_KEY))
                  console.log(JSON.stringify(
                    { PAYER_ADDRESS, FUNDER_ADDRESS },
                    undefined, 2))
                  return bsk.transactions.makeBitcoinSpend(address, REGTEST_FUNDER, 2500000) }))
          .then((spendTX) => {
            if (!broadcastSpend) {
              return
            } else {
              return bsk.config.network.broadcastTransaction(spendTX)
                .then((txid) => {
                  console.log(`Regtest set and funding broadcasted: ${txid}`)
                })
            }
          })
}

function setTestnet (device) {
  bsk.config.network = bsk.network.defaults.LOCAL_REGTEST
  bsk.config.network.blockstackAPIUrl    = `http://${TESTNET}:16268`
  bsk.config.network.broadcastServiceUrl = `http://${TESTNET}:16269`
  bsk.config.network.btc.bitcoindUrl     = `http://${TESTNET}:18332`

  // return TrezorSigner.getAddressFrom(device, payerPath)
  //  .then((address) =>
  return getTrezorSignerMultisig(device)
    .then((signer) => signer.getAddress()
          .then((payerAddress) =>
                { PAYER_ADDRESS = payerAddress
                  FUNDER_ADDRESS = bsk.ecPairToAddress(bsk.hexStringToECPair(FUNDER_KEY))
                  console.log(JSON.stringify(
                    { PAYER_ADDRESS, FUNDER_ADDRESS },
                    undefined, 2)) }))
}

function doMakePreorder (device, name, destination) {
//  return getTrezorSignerMultisig(device)
//    .then((txSigner) =>
  console.log(PAYER_ADDRESS)
  return Promise.resolve().then(() => {
    const txSigner = new NullSigner(PAYER_ADDRESS)
    return bsk.transactions.makePreorder(name, destination, txSigner)
      .catch(err => {
        return txSigner.txB.buildIncomplete().toHex() })
      .then(rawTX => {
        console.log('=== PREORDER TX ===')
        console.log(rawTX)
        return bsk.config.network.broadcastTransaction(rawTX)
              .then((resp) => {
                if (resp) {
                  trackTransaction(rawTX)
                  return doMakeRegister(device, name, destination)
                } else {
                  console.log('TX rejected by network!')
                  return rawTX
                }
              })
      })
  })
}

function doMakeStacksTransfer (device, destination) {
  return TrezorSigner.createSigner(device, payerPath)
    .then(() => {
      const txSigner = new NullSigner(PAYER_ADDRESS)
      return bsk.transactions.makeTokenTransfer(destination,
                                                'STACKS',
                                                BigInteger.fromHex('50'),
                                                'multi-sig-hello',
                                                txSigner,
                                                FUNDER_KEY,
                                                true)
      .then(rawTX => {
        console.log('=== TRANSFER TX ===')
        console.log(rawTX)
        return rawTX
      })
  })
}

function doMakeRegister (device, name, destination) {
  const zonefile = `$ORIGIN ${name}
$TTL 3600
_http._tcp URI 10 1 "https://gaia.blockstacktest.org/hub/${destination}/profile.json"`

  return getTrezorSignerMultisig(device)
    .then((txSigner) =>
      bsk.transactions.makeRegister(name, destination, txSigner, zonefile)
          .then(rawTX => {
            console.log('=== REGISTER TX ===')
            console.log(rawTX)
            trackTransaction(rawTX)
            return bsk.config.network.broadcastTransaction(rawTX)
          }))
}

function promptCompleter(line) {
  const completions = 'test-transfer'.split(' ')
  const hits = completions.filter((c) => c.startsWith(line))
  // show all completions if none found
  return [hits.length ? hits : completions, line]
}

function getMultiSigAddr (device) {
  return TrezorMultiSigner.createSigner(device, payerPath1,
                                        [payerPath1, payerPath2, payerPath3],
                                        1)
    .then(payerSigner => payerSigner.getAddress())
    .then(address => { console.log(`ADDRESS: ${address}`) })
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
    console.log('test-transfer <destination>')
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
    if (command[0] == 'test-transfer') {
      return testTransfer(trezorSession, command[1])
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

  device.on('button', function(code) { });
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

  main(device)
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

process.on('exit', function() {
    list.onbeforeunload();
})


function askUserForceAcquire(callback) {
  return setTimeout(callback, 1000);
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
  callback(null, '')
  return
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

function signTXskeleton(device, tx, inputN) {
  return signTransactionMore(device, tx, payerPath2, inputN, [0,0,0])
    .then((txPartialSign) => {
      return signTransactionMore(device, txPartialSign, payerPath1, inputN, [0,1,0])
    })
}

function testTransfer(device, destination) {
  return setTestnet(device, false)
    .then(() => doMakeStacksTransfer(device, 'miiprdeiQ72wpm4s5nfagmR2AzGqYfPmPT'))
    .then((txSkeleton) => signTXskeleton(device, txSkeleton, 0))
    .then((signedTX) => broadcastTransaction(signedTX))
    .then(console.log)
}

function main(device) {
//  startCommandLine(device, true)
//  setRegtest(device, false)
  setTestnet(device)
    .then(() => startCommandLine(device, true))
//    .then(() => signTransactionMore(device, TRANSACTION_PARTIAL_SIGN2,
//                                    payerPath2, 0, [0,0,1]))
//    .then(() => doMakePreorder(device, 'aaron.id', 'miiprdeiQ72wpm4s5nfagmR2AzGqYfPmPT'))
}


function  broadcastTransaction(transaction) {
    const jsonRPC = {
      jsonrpc: '1.0',
      method: 'sendrawtransaction',
      params: [transaction]
    }
    const bitcoindCredentials = bsk.config.network.btc.bitcoindCredentials
    const bitcoindUrl = bsk.config.network.btc.bitcoindUrl
    const authString =      Buffer.from(`${bitcoindCredentials.username}:${bitcoindCredentials.password}`)
      .toString('base64')
    const headers = { Authorization: `Basic ${authString}` }
    return fetch(bitcoindUrl, {
      method: 'POST',
      body: JSON.stringify(jsonRPC),
      headers
    })
      .then(resp => resp.json())
  }
