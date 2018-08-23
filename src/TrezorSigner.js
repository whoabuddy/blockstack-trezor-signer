import trezor from 'trezor.js'
import btc from 'bitcoinjs-lib'

const bsk = require('blockstack')

import { getTransaction, pathToPathArray, getCoinName } from './utils'

export class TrezorSigner {

  constructor(device, hdpath, address) {
    this.address = address
    this.hdpath = hdpath
    this.device = device
  }

  static createSigner(device, hdpath) {
    return TrezorSigner.getAddressFrom(device, hdpath)
      .then(address => new TrezorSigner(device, hdpath, address))
  }


  static translateInput(input) {
    const script_sig = input.script.length > 0 ? input.script.toString('hex') : null
    return {
      prev_index: input.index,
      prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
      sequence: input.sequence,
      script_sig
    }
  }

  static getAddressFrom(device, hdpath) {
    return device.waitForSessionAndRun((session) => {
      let hdPathArray = pathToPathArray(hdpath)
      return session.getAddress(hdPathArray, getCoinName(), false)
    }).then(response => response.message.address)
  }

  getAddress() {
    return Promise.resolve(this.address)
  }

  prepareInputs(inputs, myIndex) {
    return inputs
      .map((input, inputIndex) => {
        const translated = TrezorSigner.translateInput(input)
        if (inputIndex === myIndex) {
          translated.address_n = pathToPathArray(this.hdpath)
        }
        return translated
      })
  }

  prepareOutputs(outputs) {
    return outputs
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
  }

  signTransaction(txB, signInputIndex) {
    return this.signTransactionSkeleton(txB.__tx, signInputIndex)
      .then((resp) => {
        const signedTxHex = resp.tx
        // god of abstraction, forgive me, for I have transgressed
        const signedTx = btc.Transaction.fromHex(signedTxHex)
        const signedTxB = btc.TransactionBuilder.fromTransaction(signedTx)
        txB.__inputs[signInputIndex] = signedTxB.__inputs[signInputIndex]
      })
  }

  prepareTransactionInfo(tx, signInputIndex) {
    return Promise.resolve()
      .then(() => {
        // we need to do a _lot_ of garbage here.
        // Step 1: prepare inputs / outputs for trezor format
        const inputs = this.prepareInputs(tx.ins, signInputIndex)
        const outputs = this.prepareOutputs(tx.outs)

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
                inputs: transaction.ins.map(TrezorSigner.translateInput),
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
          .then((referrantTXs) => ({
            inputs, outputs, referrants: referrantTXs
          }))
      })
  }

  signTransactionSkeleton(tx, signInputIndex) {
    return this.prepareTransactionInfo(tx, signInputIndex)
      .then((txInfo) => {
        const coinName = getCoinName()
        return this.device.waitForSessionAndRun(
          (session) =>
            session.signTx(txInfo.inputs, txInfo.outputs, txInfo.referrants, coinName, tx.locktime))
          .then(resp => ({tx: resp.message.serialized.serialized_tx}))
      })
  }

  signerVersion() {
    return 1
  }
}

