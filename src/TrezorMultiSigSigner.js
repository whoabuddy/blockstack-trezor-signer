import trezor from 'trezor.js'
import btc from 'bitcoinjs-lib'

const bsk = require('blockstack')

import { getTransaction, pathToPathArray, getCoinName } from './utils'

export class TrezorMultiSigner {

  constructor(device, hdpath, address, pubkeys, m, signatures) {
    this.address = address
    this.hdpath = hdpath
    this.device = device
    this.multisig = { pubkeys, m, signatures }
  }

  static getHDNode(device, hdpath) {
    return device.waitForSessionAndRun((session) => {
      let hdPathArray = pathToPathArray(hdpath)
      return session.getHDNode(hdPathArray, getCoinName())
    })
  }

  static createSigner(device, myPath, hdpaths, m) {
    return Promise.all(
      hdpaths.map(x => TrezorMultiSigner.getHDNode(device, x)))
      .then(hdNodes => {
        const pubkeys = hdNodes.map(x => ({
          node: {
            depth: x.depth,
            fingerprint: x.getFingerprint().readUInt32LE(0),
            child_num: x.index,
            chain_code: x.chainCode,
            public_key: x.getPublicKeyBuffer()
          },
          address_n: [] }))
        console.log('EXPECTED PUBKEYS:')
        console.log(JSON.stringify(
          pubkeys.map(x => x.node.public_key.toString('hex')), undefined, 2))
        const address = computeMultiSigAddress(hdNodes, m)
        const signatures = hdNodes.map(() => '')
        return new TrezorMultiSigner(device, myPath, address, pubkeys, m, signatures)
      })
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
                  translated.multisig = this.multisig
                  translated.script_type = 'SPENDMULTISIG'
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
                  console.log(`GOT ADDRESS: ${address}`)
                  return { address,
                           amount: output.value,
                           script_type: 'PAYTOADDRESS' }
                }
              })

        console.log('OUTPUTS:')
        console.log(JSON.stringify(outputs, undefined, 2))

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
          .then(resp => {
            console.log(resp)
            return { tx: resp.message.serialized.serialized_tx,
                     signatures: resp.message.serialized.signatures }
          })
      })
      .then((resp) => {
        const signedTxHex = resp.tx
        const signatures = resp.signatures
        console.log(signedTxHex)
        console.log(signatures)
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

function computeMultiSigAddress(hdNodes, m) {
  const pubkeys = hdNodes.map(x => x.getPublicKeyBuffer())
  const redeem = btc.payments.p2ms({ m, pubkeys })
  console.log(redeem)
  const script = btc.payments.p2sh({ redeem })
  const address = script.address
  const addressHash = btc.address.fromBase58Check(address).hash
  const version = bsk.config.network.layer1.scriptHash
  return btc.address.toBase58Check(addressHash, version)
}
