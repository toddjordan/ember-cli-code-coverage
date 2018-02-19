'use strict';

const { parse, print } = require('htmlbars/dist/cjs/htmlbars-syntax');
const expect = require('chai').expect;
const getPlugin = require('../../lib/template-instrumenter');
const fs = require('fs');
const path = require('path');

function prettyPrint(str) {
  return print(str).replace(/\{\{/g, '\n{{').replace(/\n *\n/g, '\n').replace(/ +\n/g, '\n');
}

function testInstrument(inputFile, expectedFile) {
  let input = fs.readFileSync(path.join(__dirname, '../fixtures/templates', inputFile)).toString();
  let expected = fs.readFileSync(path.join(__dirname, '../fixtures/templates', expectedFile)).toString();
  let parsedInput = prettyPrint(parse(input.trim(), {
    plugins: {
      ast: [ getPlugin(() => ['included-module'], () => ['excluded-module']) ]
    },
    meta: {
      moduleName: 'included-module'
    }
  }));
  let parsedExpected = prettyPrint(parse(expected.trim()));

  expect(parsedInput).to.equal(parsedExpected);
}

describe('template-instrumenter.js', function() {

  it('instruments an htmlbars template', function() {
    testInstrument('input.hbs', 'expected.hbs');
  });

});

