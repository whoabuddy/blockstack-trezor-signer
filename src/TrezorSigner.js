import btc from 'bitcoinjs-lib'
import TrezorConnect from 'trezor-connect'

import { config as bskConfig } from 'blockstack'

import { pathToPathArray, getCoinName } from './utils'

/* from readme for local dev:
TrezorConnect.init({
  connectSrc: 'https://localhost:9876/',
  lazyLoad: true, // this param will prevent iframe injection until TrezorConnect.method will be called
  manifest: {
    email: 'admin@blockstack.com',
    appUrl: 'https://blockstack.org',
  },
})
*/

// manifest below is bare minimum v7+
TrezorConnect.manifest({
  email: 'admin@blockstack.com',
  appUrl: 'https://blockstack.org',
})

export class TrezorSigner {
  constructor(hdpath, address) {
    this.address = address
    this.hdpath = hdpath
  }

  static createSigner(hdpath) {
    return TrezorSigner.getAddressFrom(hdpath).then(
      (address) => new TrezorSigner(hdpath, address)
    )
  }

  static translateInput(input) {
    const scriptSig =
      input.script.length > 0 ? input.script.toString('hex') : null
    return {
      prev_index: input.index,
      prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
      sequence: input.sequence,
      script_sig: scriptSig,
    }
  }

  static getPublicKeys(paths): Promise<[string]> {
    return TrezorConnect.getPublicKey({
      bundle: paths.map((path) => ({ path })),
    }).then((response) => {
      if (!response.success) {
        if (response.payload && response.payload.error) {
          throw new Error(
            `Failed to load addresses from Trezor: ${response.payload.error}`
          )
        } else {
          throw new Error('Failed to load addresses from Trezor')
        }
      }
      const values = response.payload
      return paths.map((path) => {
        const xpub = values.find(
          (value) => `m/${value.serializedPath}` === path
        ).xpub
        const pk = btc.bip32.fromBase58(xpub).publicKey
        return pk.toString('hex')
      })
    })
  }

  static getAddressFrom(hdpath) {
    return TrezorSigner.getPublicKeys([hdpath]).then((pks) => {
      const address = btc.payments.p2pkh({
        pubkey: Buffer.from(pks[0], 'hex'),
      }).address
      return bskConfig.network.coerceAddress(address)
    })
  }

  getAddress() {
    return Promise.resolve(this.address)
  }

  prepareInputs(inputs, myIndex) {
    return inputs.map((input, inputIndex) => {
      const translated = TrezorSigner.translateInput(input)
      if (inputIndex === myIndex) {
        translated['address_n'] = pathToPathArray(this.hdpath)
      }
      return translated
    })
  }

  prepareOutputs(outputs) {
    return outputs.map((output) => {
      if (btc.script.toASM(output.script).startsWith('OP_RETURN')) {
        const nullData = btc.script.decompile(output.script)[1]
        return {
          op_return_data: nullData.toString('hex'),
          amount: '0',
          script_type: 'PAYTOOPRETURN',
        }
      } else {
        const address = bskConfig.network.coerceAddress(
          btc.address.fromOutputScript(output.script)
        )
        return {
          address,
          amount: `${output.value}`,
          script_type: 'PAYTOADDRESS',
        }
      }
    })
  }

  signTransaction(txB, signInputIndex) {
    return this.signTransactionSkeleton(txB.__tx, signInputIndex).then(
      (resp) => {
        const signedTxHex = resp.tx
        // god of abstraction, forgive me, for I have transgressed
        const signedTx = btc.Transaction.fromHex(signedTxHex)
        const signedTxB = btc.TransactionBuilder.fromTransaction(signedTx)
        txB.__inputs[signInputIndex] = signedTxB.__inputs[signInputIndex]
      }
    )
  }

  prepareTransactionInfo(tx, signInputIndex, extra) {
    return Promise.resolve().then(() => {
      // we need to do a _lot_ of garbage here.
      // prepare inputs / outputs for trezor format
      const inputs = this.prepareInputs(tx.ins, signInputIndex, extra)
      const outputs = this.prepareOutputs(tx.outs)

      return { inputs, outputs }
    })
  }

  signTransactionSkeleton(tx, signInputIndex, extra) {
    return this.prepareTransactionInfo(tx, signInputIndex, extra).then(
      (txInfo) => {
        const coin = getCoinName()
        return TrezorConnect.signTransaction({
          inputs: txInfo.inputs,
          outputs: txInfo.outputs,
          coin,
        }).then((resp) => {
          if (!resp.success) {
            if (resp.payload && resp.payload.error) {
              throw new Error(
                `Failed to sign Trezor transaction: ${resp.payload.error}`
              )
            } else {
              throw new Error('Failed to sign Trezor transaction.')
            }
          }
          return {
            tx: resp.payload.serializedTx,
            signatures: resp.payload.signatures,
          }
        })
      }
    )
  }

  signerVersion() {
    return 1
  }
}
