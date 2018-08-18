import { DeviceList } from 'trezor.js'
import btc from 'bitcoinjs-lib'
import readline from 'readline'
import process from 'process'
import { TrezorMultiSigner } from './TrezorMultiSigSigner'

const bsk = require('blockstack')

import { pathToPathArray, getCoinName, trackTransaction } from './utils'
import { TrezorSigner } from './TrezorSigner'

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

let PASSPHRASE_CACHE = false

function doGetAddressInfo(device, hdpath) {
  return TrezorSigner.getAddressFrom(device, hdpath)
    .then((address) => {
      console.log(`Address = ${address}`)
    })
}

function setRegtest (device) {
  bsk.config.network = bsk.network.defaults.LOCAL_REGTEST
  // return TrezorSigner.getAddressFrom(device, payerPath)
  //  .then((address) =>
  const address = '2MumTuqZ5nzfZHEitAQ1B1GyEeRiGTuPPEb'
  return bsk.transactions.makeBitcoinSpend(address, REGTEST_FUNDER, 2500000)
    .then((x) => bsk.config.network.broadcastTransaction(x))
    .then((txid) => {
      console.log(`Regtest set and funding broadcasted: ${txid}`)
    })
}

function doMakePreorder (device, name, destination) {
  return TrezorMultiSigner.createSigner(device, payerPath1,
                                        [payerPath1, payerPath2, payerPath3],
                                        1)
    .then((txSigner) =>
      bsk.transactions.makePreorder(name, destination, txSigner)
          .then(rawTX => {
            console.log('=== PREORDER TX ===')
            console.log(rawTX)
            trackTransaction(rawTX)
            return bsk.config.network.broadcastTransaction(rawTX)
          }))
    .then(() => doMakeRegister(device, name, destination))
}

function doMakeRegister (device, name, destination) {
  const zonefile = `$ORIGIN ${name}
$TTL 3600
_http._tcp URI 10 1 "https://gaia.blockstacktest.org/hub/${destination}/profile.json"`

  return TrezorMultiSigner.createSigner(device, payerPath1,
                                        [payerPath1, payerPath2, payerPath3],
                                        1)
    .then((txSigner) =>
      bsk.transactions.makeRegister(name, destination, txSigner, zonefile)
          .then(rawTX => {
            console.log('=== REGISTER TX ===')
            console.log(rawTX)
            trackTransaction(rawTX)
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
                  trackTransaction(rawTX)
                  return bsk.config.network.broadcastTransaction(rawTX)
                })))
}

function promptCompleter(line) {
  const completions = 'make-register get-addr set-reg-test make-update'.split(' ')
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
    console.log('set-reg-test')
    console.log('get-addr-multi')
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
      return setRegtest(trezorSession).then(
        () => startCommandLine(trezorSession))
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
    } else if (command[0] == 'get-addr-multi') {
      return getMultiSigAddr(trezorSession)
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

//  startCommandLine(device, true)
  setRegtest(device)
    .then(() => doMakePreorder(device, 'aaron.id', 'miiprdeiQ72wpm4s5nfagmR2AzGqYfPmPT'))
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

