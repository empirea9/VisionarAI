const path = require('path');

module.exports = {
  entry: {
    'offscreen/offscreen.bundle': './offscreen/offscreen.src.js',
  },
  output: {
    path: path.resolve(__dirname),
    filename: '[name].js',
  },
  mode: 'production',
  resolve: {
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      os: false,
      stream: false,
      buffer: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
    ],
  },
  performance: {
    maxAssetSize: 5 * 1024 * 1024,
    maxEntrypointSize: 5 * 1024 * 1024,
  },
  optimization: {
    minimize: true,
  },
};
