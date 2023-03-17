'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TrezorMultiSigSigner = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _bitcoinjsLib = require('bitcoinjs-lib');

var _bitcoinjsLib2 = _interopRequireDefault(_bitcoinjsLib);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _blockstack = require('blockstack');

var _TrezorSigner2 = require('./TrezorSigner');

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var TrezorMultiSigSigner = exports.TrezorMultiSigSigner = function (_TrezorSigner) {
  _inherits(TrezorMultiSigSigner, _TrezorSigner);

  function TrezorMultiSigSigner(hdpath, redeemScript, address) {
    _classCallCheck(this, TrezorMultiSigSigner);

    var _this = _possibleConstructorReturn(this, (TrezorMultiSigSigner.__proto__ || Object.getPrototypeOf(TrezorMultiSigSigner)).call(this, hdpath, address));

    var redeemScriptBuffer = Buffer.from(redeemScript, 'hex');
    _this.p2ms = _bitcoinjsLib2.default.payments.p2ms({ output: redeemScriptBuffer });
    return _this;
  }

  _createClass(TrezorMultiSigSigner, [{
    key: 'prepareInputs',
    value: function prepareInputs(inputs, myIndex, multisig) {
      var _this2 = this;

      return inputs.map(function (input, inputIndex) {
        var translated = _TrezorSigner2.TrezorSigner.translateInput(input);
        if (inputIndex === myIndex) {
          translated['address_n'] = (0, _utils.pathToPathArray)(_this2.hdpath);
          translated['multisig'] = multisig;
          translated['script_type'] = 'SPENDMULTISIG';
        }
        return translated;
      });
    }
  }, {
    key: 'signTransaction',
    value: function signTransaction(txB, signInputIndex) {
      var signatures = [];
      var txBSigs = txB.__inputs[signInputIndex].signatures;
      if (txBSigs) {
        signatures = txBSigs.map(function (signature) {
          if (signature) {
            return signature.toString('hex').slice(0, -2);
          } else {
            return '';
          }
        });
      } else {
        signatures = this.p2ms.pubkeys.map(function () {
          return '';
        });
      }

      var pubkeys = this.p2ms.pubkeys.map( // make fake xpubs?
      function (pubkey) {
        var chainCode = _crypto2.default.randomBytes(32);
        var hdNode = _bitcoinjsLib2.default.bip32.fromPublicKey(pubkey, chainCode);
        hdNode.network = _blockstack.config.network.layer1;
        return { node: hdNode.toBase58() };
      });

      var multisig = { pubkeys: pubkeys,
        m: this.p2ms.m,
        signatures: signatures };

      return this.signTransactionSkeleton(txB.__tx, signInputIndex, multisig).then(function (resp) {
        var signedTxHex = resp.tx;
        // god of abstraction, forgive me, for I have transgressed
        var signedTx = _bitcoinjsLib2.default.Transaction.fromHex(signedTxHex);
        var signedTxB = _bitcoinjsLib2.default.TransactionBuilder.fromTransaction(signedTx);
        txB.__inputs[signInputIndex] = signedTxB.__inputs[signInputIndex];
      });
    }
  }, {
    key: 'signerVersion',
    value: function signerVersion() {
      return 1;
    }
  }], [{
    key: 'createSigner',
    value: function createSigner(path, redeemScript) {
      var p2ms = _bitcoinjsLib2.default.payments.p2ms({ output: Buffer.from(redeemScript, 'hex') });
      var script = _bitcoinjsLib2.default.payments.p2sh({ redeem: p2ms });

      var address = _blockstack.config.network.coerceAddress(script.address);
      console.log('SCRIPT ADDR: ' + script.address + ', ADDR: ' + address);

      return Promise.resolve().then(function () {
        return new TrezorMultiSigSigner(path, redeemScript, address);
      });
    }
  }]);

  return TrezorMultiSigSigner;
}(_TrezorSigner2.TrezorSigner);