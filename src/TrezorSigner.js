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

  static getAddressFrom(device, hdpath) {
    return device.waitForSessionAndRun((session) => {
      let hdPathArray = pathToPathArray(hdpath)
      return session.getAddress(hdPathArray, getCoinName(), false)
    }).then(response => response.message.address)
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


function translateInput(input) {
  const script_sig = input.hash.length > 0 ? input.script.toString('hex') : null
  return {
    prev_index: input.index,
    prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
    script_sig
  }
}
