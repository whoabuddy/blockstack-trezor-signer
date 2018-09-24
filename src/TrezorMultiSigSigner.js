import btc from 'bitcoinjs-lib'

const bsk = require('blockstack')

import { TrezorSigner } from './TrezorSigner'
import { getTransaction, pathToPathArray, getCoinName } from './utils'

export class TrezorMultiSigner extends TrezorSigner {

  constructor(device, hdpath, address, pubkeys, m, signatures, redeemScript) {
    super(device, hdpath, address)
    this.multisig = { pubkeys, m, signatures }
    this.redeemScript = redeemScript
  }

  static getHDNode(device, hdpath) {
    return device.waitForSessionAndRun((session) => {
      let hdPathArray = pathToPathArray(hdpath)
      return session.getHDNode(hdPathArray, getCoinName())
    })
  }

  static createSigner(device, myPath, hdpaths, m, signatures) {
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
        const { address, redeemScript } = TrezorMultiSigner.computeMultiSigAddress(hdNodes, m)
        if (!signatures) {
          signatures = hdNodes.map(() => '')
        }
        return new TrezorMultiSigner(device, myPath, address, pubkeys, m, signatures, redeemScript)
      })
  }

  static computeMultiSigAddress(hdNodes, m) {
    const pubkeys = hdNodes.map(x => x.getPublicKeyBuffer())
    const redeem = btc.payments.p2ms({ m, pubkeys })
    const script = btc.payments.p2sh({ redeem })
    const address = script.address
    const addressHash = btc.address.fromBase58Check(address).hash
    const version = bsk.config.network.layer1.scriptHash
    return { address: btc.address.toBase58Check(addressHash, version),
             redeemScript: redeem.output.toString('hex') }
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

  signTransactionSkeleton(tx, signInputIndex) {
    return this.prepareTransactionInfo(tx, signInputIndex)
      .then((txInfo) => {
        const coinName = getCoinName()
        return this.device.waitForSessionAndRun(
          (session) =>
            session.signTx(txInfo.inputs, txInfo.outputs, txInfo.referrants, coinName))
          .then(resp => {
            return { tx: resp.message.serialized.serialized_tx,
                     signatures: resp.message.serialized.signatures }
          })
      })
  }

  signerVersion() {
    return 1
  }
}
