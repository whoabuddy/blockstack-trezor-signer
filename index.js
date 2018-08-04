require("babel-polyfill")

const trezor = require('trezor.js')
const BigNumber = require('bignumber.js')
const Eth = require('web3-eth')
const readline = require('readline')
const Writable = require('stream').Writable
const Tx = require('ethereumjs-tx')
const ethHDKey = require('ethereumjs-wallet/hdkey')
const process = require('process')

const debug = true

// DeviceList encapsulates transports, sessions, device enumeration and other
// low-level things, and provides easy-to-use event interface.
const list = new trezor.DeviceList()

const eth = new Eth()
const WEI_IN_ETH = new BigNumber('1e18')

const DO_CACHE_PASSPHRASE = !!process.env.CACHE_PASSPHRASE

let ADDRESS_MAP = {}
let PASSPHRASE_CACHE = false

connectToEthereumProvider()

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

function loadAddresses(device, count = 4096) {
  return device.waitForSessionAndRun((session) => {
    return session.getHDNode(pathToPathArray(`m/44'/60'/0'/0`), 'bitcoin')
  })
    .then(bjsHD => {
      const ethHD = ethHDKey.fromExtendedKey(bjsHD.toBase58())
      const derived = {}
      for (i = 0; i < count; i++) {
        if (i % 512 == 0) {
          console.log('...')
        }
        let addr = ethHD.derivePath(`m/${i}`)
            .getWallet()
            .getAddressString()
            .toLowerCase()
        let path = `m/44'/60'/0'/0/${i}`
        derived[addr] = path
      }
      console.log('Loaded addresses!')
      return derived
    })
    .then(derived => {
      ADDRESS_MAP = derived
    })
}

function connectToEthereumProvider (httpProvider) {
  if (!httpProvider) {
    httpProvider = 'https://api.myetherapi.com/eth'
  }
  eth.setProvider(new Eth.providers.HttpProvider(httpProvider))
}

function getAddressFrom (device, hdpath) {
  return device.waitForSessionAndRun((session) => {
    let hdPathArray = pathToPathArray(hdpath)
    return session.ethereumGetAddress(hdPathArray)
  })
    .then(response => response.message.address)
}

function doGetAddressInfo(device, hdpath) {
  return getAddressFrom(device, hdpath)
    .then((address) => {
      console.log(`Address = 0x${address}`)
      return eth.getBalance(`0x${address}`)
    })
    .then((balance) => {
      ethBalance = new BigNumber(balance).div(WEI_IN_ETH)
      console.log(`ETH Bal = ${ethBalance}`)
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

function doSigningInteractions (device, hdPathFrom, addressTo, requestSendEth) {
  if (addressTo.startsWith('0x')) {
    addressTo = addressTo.slice(2)
  }
  addressTo = addressTo.toLowerCase()

  let fromAddress
  return getAddressFrom(device, hdPathFrom)
    .then((fromAddressResp) => {
      fromAddress = fromAddressResp
      return Promise.all(
        [ eth.getBalance(`0x${fromAddress}`), // in wei
          eth.getGasPrice(), // in wei
          eth.estimateGas({to: `0x${addressTo}`}), // in gas
          eth.getTransactionCount(`0x${fromAddress}`) // the nonce
        ])
    })
    .then(([balanceWei, gasPrice, gasLimit, nonce]) => {
      let nonceToUse = new BigNumber(nonce)
      let gasPriceWei = new BigNumber(gasPrice)
      let toSend
      if (requestSendEth) {
        toSend = new BigNumber(requestSendEth).times(WEI_IN_ETH)
        if (toSend.gt(balanceWei)) {
          throw new Error(`Tried to send too much wei (${toSend}). Balance (in wei): ${balanceWei}`)
        }
        toSend = toSend.minus(gasPriceWei.times(gasLimit + 1))
      } else {
        toSend = new BigNumber(balanceWei)
          .minus(gasPriceWei.times(gasLimit + 1))
      }

      let toSendEth = new BigNumber(toSend).div(WEI_IN_ETH)
      let gasPriceEth = gasPriceWei.div(WEI_IN_ETH)

      console.log('Creating transaction with properties:')
      console.log(`from     =      0x${fromAddress}`)
      console.log(`to       =      0x${addressTo}`)
      console.log(`value    =      ${toSendEth} eth`)
      console.log(`gasLimit =      ${gasLimit}`)
      console.log(`gasPrice =      ${gasPriceEth} eth`)
      console.log(`nonce    =      ${nonceToUse}`)

      let hdPathArray = pathToPathArray(hdPathFrom)

      return device.waitForSessionAndRun((session) => {
        return session
          .signEthTx(hdPathArray, paddedHex(nonceToUse),
                     paddedHex(gasPriceWei), paddedHex(gasLimit),
                     addressTo,
                     paddedHex(toSend),
                     null,
                     1)
          .then((response) => {
            if (response) {
              const txParams = {
                nonce: `0x${paddedHex(nonceToUse)}`,
                gasLimit: `0x${paddedHex(gasLimit)}`,
                gasPrice: `0x${paddedHex(gasPriceWei)}`,
                to: `0x${addressTo}`,
                value: `0x${paddedHex(toSend)}`,
                v: `0x${paddedHex(response.v)}`,
                r: `0x${response.r}`,
                s: `0x${response.s}`,
                chainId: 1
              }
              const signedtx = new Tx(txParams)
              console.log('Signed Serialized Transaction: ( you can broadcast at https://etherscan.io/pushTx )')
              console.log('')
              console.log('0x' + signedtx.serialize().toString('hex'))
              console.log('')
            } else {
              console.error('Error obtaining signed response from trezor!')
            }
          })
      })
    })
}

function promptCompleter(line) {
  const completions = 'signtx loadaddrs getaddr'.split(' ')
  const hits = completions.filter((c) => c.startsWith(line))
  // show all completions if none found
  return [hits.length ? hits : completions, line]
}

function startCommandLine(trezorSession, showCommands) {
  if (showCommands) {
    console.log('')
    console.log('Direct ethereum-trezor wallet interactions.')
    if (DO_CACHE_PASSPHRASE) {
      console.log('')
      console.log('WARNING: currently configured to cache the "passphrase" in memory so it doesnt prompt on every trezor operation.')
      console.log('')
    }
    console.log('')
    console.log('Note: "loadaddrs" loads the devices addresses into memory for use as options in other commands')
    console.log('')
    console.log('Commands supported: ')
    console.log('')
    console.log('loadaddrs')
    console.log('signtx <hd-path or address index or address to withdraw> <address to send funds to> <optional: amount of eth to send, defaults to *all* funds from address>')
    console.log('getaddr <hd-path or address index or address to lookup balance>')
    console.log('')
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: promptCompleter,
  })


  rl.question("CMD> ", function (line) {
    rl.close()
    let command = line.trim().split(' ')
    if (command[0] == 'signtx') {
      let amount = false
      if (command.length > 3) {
        amount = command[3]
      }
      return doSigningInteractions(trezorSession, command[1], command[2], amount)
        .catch((err) => {
          console.log(err)
          console.log('ERROR OCCURRED IN LAST COMMAND.')
        })
        .then(() => startCommandLine(trezorSession))
    } else if (command[0] == 'getaddr') {
      return doGetAddressInfo(trezorSession, command[1])
        .catch((err) => {
          console.log(err)
          console.log('ERROR OCCURRED IN LAST COMMAND.')
        })
        .then(() => startCommandLine(trezorSession))
    } else if (command[0] == 'loadaddrs') {
      return loadAddresses(trezorSession)
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
  // low level API
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

// an example function, that asks user for acquiring and
// calls callback if use agrees
// (in here, we will call agree always, since it's just an example)
function askUserForceAcquire(callback) {
    return setTimeout(callback, 1000);
}

/**
 * @param {string}
 */
function buttonCallback(label, code) {
  console.log()
  console.log("Look at your trezor and press the button, human.")
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


/**
 * @param {Function<Error, string>} callback
 */
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

/*(function wait () {
   if (true) setTimeout(wait, 1000);
})();*/
