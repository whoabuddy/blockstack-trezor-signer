import TrezorConnect from 'trezor-connect'
import btc from 'bitcoinjs-lib'

const bsk = require('blockstack')

import { TrezorSigner } from './TrezorSigner'
import { getTransaction, pathToPathArray, getCoinName } from './utils'

export class TrezorMultiSigner extends TrezorSigner {

  constructor(hdpath, redeemScript: string, address: string) {
    super(hdpath, address)
    const redeemScriptBuffer = Buffer.from(redeemScript, 'hex')
    this.p2ms = btc.payments.p2ms({ output: redeemScriptBuffer })
  }

  static getMultiSigInfo(txB: TransactionBuilder) {
  }

  static getHDNode(device, hdpath) {
    return device.waitForSessionAndRun((session) => {
      let hdPathArray = pathToPathArray(hdpath)
      return session.getHDNode(hdPathArray, getCoinName())
    })
  }

  static createSigner(path, redeemScript) {
    const address = btc.payments
          .p2ms({ output: Buffer.from(redeemScript, 'hex') })
          .address
    return Promise.resolve().then(() => new TrezorMultiSigner(
      path, redeemScript, address))
  }

  prepareInputs(inputs, myIndex) {
    return inputs
      .map((input, inputIndex) => {
        const translated = TrezorSigner.translateInput(input)
        if (inputIndex === myIndex) {
          translated.address_n = pathToPathArray(this.hdpath)
          translated.multisig = this.multisig
          translated.script_type = 'SPENDMULTISIG'
        }
        return translated
      })
  }

  signTransaction(txB, signInputIndex) {
    let signatures = []
    const txBSigs = txB.__inputs[signInputIndex].signatures
    if (txBSigs) {
      signatures = txBSigs.map(signature => {
        if (signature) {
          return signature.toString('hex').slice(0, -2)
        } else {
          return ''
        }
      })
    } else {
      signatures = this.p2ms.pubkeys.map(() => '')
    }

    const multisig = { pubkeys: this.p2ms.pubkeys,
                       m: this.p2ms.m,
                       signatures }

    return this.signTransactionSkeleton(txB.__tx, signInputIndex, multisig)
      .then((resp) => {
        const signedTxHex = resp.tx
        // god of abstraction, forgive me, for I have transgressed
        const signedTx = btc.Transaction.fromHex(signedTxHex)
        const signedTxB = btc.TransactionBuilder.fromTransaction(signedTx)
        txB.__inputs[signInputIndex] = signedTxB.__inputs[signInputIndex]
      })
  }

  signTransactionSkeleton(tx, signInputIndex, multisig) {
    return this.prepareTransactionInfo(tx, signInputIndex, multisig)
      .then((txInfo) => {
        const coin = getCoinName()
        return TrezorConnect.signTransaction({ inputs: txInfo.inputs,
                                               outputs: txInfo.outputs,
                                               coin })
          .then(resp => {
            if (!resp.success){
              console.log(JSON.stringify(resp, undefined, 2))
              throw new Error('Failed to sign Trezor transaction!')
            }
            return { tx: resp.payload.serializedTx }
          })
      })
  }

  signerVersion() {
    return 1
  }
}
