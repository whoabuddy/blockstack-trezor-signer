import btc from 'bitcoinjs-lib'
import fetch from 'cross-fetch'
const bsk = require('blockstack')

const KNOWN_TX_MAP = {}

export function getTransaction (txId) {
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

export function trackTransaction(rawTX) {
  bsk.config.network.modifyUTXOSetFrom(rawTX)
  const txid = btc.Transaction.fromHex(rawTX).getId()
  KNOWN_TX_MAP[txid] = rawTX
}

export function getCoinName() {
  const network = bsk.config.network.layer1
  if (network.pubKeyHash === 0) {
    return 'bitcoin'
  } else if (network.pubKeyHash === 111) {
    return 'testnet'
  }
  throw new Error('Unknown layer 1 network')
}

export function pathToPathArray (path) {
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
