import btc from 'bitcoinjs-lib'
import { TrezorMultiSigner } from './TrezorMultiSigSigner'
import fetch from 'cross-fetch'
import BigInteger from 'bigi'

const bsk = require('blockstack')

import { pathToPathArray, getCoinName, trackTransaction, TrezorSigner,
         TrezorMultiSigSigner, NullSigner } from '../../lib/'


const debug = true

const payerPath = `m/44'/5757'/0'/0/0`
const MULTI_1 = `m/44'/5757'/0'/0/1`
const MULTI_2 = `m/44'/5757'/0'/0/2`
const MULTI_3 = `m/44'/5757'/0'/0/3`

const FUNDER_KEY = 'b94e0a49f76b605b37508a8dd7ed465aac4591d57993abe2f286421e35f1dcd901'

const REGTEST_FUNDER = 'bb68eda988e768132bc6c7ca73a87fb9b0918e9a38d3618b74099be25f7cab7d01'

let PASSPHRASE_CACHE = false

let FUNDER_ADDRESS = false

function getMultiSigInfo() {
  return TrezorSigner.getPublicKeys([MULTI_1, MULTI_2, MULTI_3])
    .then((xpubs) => {
      const pubkeys = xpubs.map(xpub => btc.bip32.fromBase58(xpub).publicKey)
      const redeem = btc.payments.p2ms({ m: 2, pubkeys })
      const script = btc.payments.p2sh({ redeem })
      const address = script.address
      return {
        address: {
          multiSigAddress: bsk.config.network.coerceAddress(address),
          funderAddress: bsk.ecPairToAddress(
            bsk.hexStringToECPair(FUNDER_KEY))
        },
        redeemScript: redeem.output.toString('hex')
      }
    })
}

function setTestnet() {
  bsk.config.network = bsk.network.defaults.LOCAL_REGTEST
  bsk.config.network.blockstackAPIUrl    = `http://${TESTNET}:16268`
  bsk.config.network.broadcastServiceUrl = `http://${TESTNET}:16269`
  bsk.config.network.btc = new bsk.network.InsightClient('https://testnet-bitcore1.trezor.io/api')
  bsk.config.network.getFeeRate = () => Promise.resolve(1)
}

function doMakeStacksTransferMulti(destination, payerAddress) {
  const txSigner = new NullSigner(payerAddress)
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
}

function signTransactionMore(txHex, inputN, path, redeemScript) {
  const tx = btc.Transaction.fromHex(txHex)
  const TxB = btc.TransactionBuilder.fromTransaction(tx)

  return TrezorMultiSigner.createSigner(path, redeemScript)
    .then(txSigner => txSigner.signTransaction(TxB, inputN))
    .then(() => {
      const tx = TxB.build().toHex()
      console.log('== SIGNED TX ==')
      console.log(tx)
      return tx
    })
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


export function runMultiSigTest() {
  setTestnet()
  getMultiSigInfo()
    .then((info) => {
      console.log(`Trezor Addresses:\n ${JSON.stringify(info.address, undefined, 2)}`)
      console.log(`Redeem Script:\n ${JSON.stringify(info.redeemScript, undefined, 2)}`)
      return doMakeStacksTransferMulti('miiprdeiQ72wpm4s5nfagmR2AzGqYfPmPT', info.address.multiSigAddress)
        .then(rawTX => signTransactionMore(rawTX, 0, MULTI_2, info.redeemScript))
        .then(signedOnce => signTransactionMore(signedOnce, 0, MULTI_1, info.redeemScript))
//        .then(x => broadcastTransaction(x))
//        .then(x => console.log(`Broadcast result: ${JSON.stringify(x, undefined, 2)}`))
    })
}
