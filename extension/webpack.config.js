const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

const target = process.env.TARGET || 'firefox';
const manifestFile = target === 'chromium' ? 'manifest.chromium.json' : 'manifest.json';
const isTest = process.env.TABARCHIVE_TEST === '1';

module.exports = {
  entry: {
    popup: './popup/popup.tsx',
    background: './background.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      __TABARCHIVE_TEST__: JSON.stringify(isTest),
    }),
    new CopyPlugin({
      patterns: [
        { from: manifestFile, to: 'manifest.json' },
        { from: 'popup/popup.html', to: 'popup/popup.html' },
        { from: 'icons', to: 'icons', noErrorOnMissing: true },
      ],
    }),
  ],
  devtool: 'source-map',
};
