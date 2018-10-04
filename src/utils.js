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
  const pieces = path.split('/')
  if (pieces.length === 1 || pieces[0] !== 'm') {
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

export function configureTestnet(blockstackTestnet = 'testnet.blockstack.org') {
  bsk.config.network = bsk.network.defaults.LOCAL_REGTEST
  bsk.config.network.blockstackAPIUrl    = `http://${blockstackTestnet}:16268`
  bsk.config.network.broadcastServiceUrl = `http://${blockstackTestnet}:16269`
  bsk.config.network.btc = new bsk.network.InsightClient('https://test-insight.bitpay.com/api')
  bsk.config.network.getFeeRate = () => Promise.resolve(1)
}
