'use strict';

const LINE_ENDINGS = /(?:\r\n?|\n)/;
const testExclude = require('test-exclude');
const istanbul = require('istanbul-api');

module.exports = function(includes, excludes) {


  return class IstanbulInstrumenter {
    constructor(options) {
      this.options = options;

      let moduleName = this.moduleName = options.meta.moduleName;
      this.exclude = testExclude({
        include: includes(),
        exclude: excludes(),
      });

      this.coverageData = istanbul.libCoverage.createFileCoverage(moduleName).data;

      this._currentStatement = 0;
      this._currentBranch = 0;

      if (options.contents) {
        this.coverageData.code = options.contents.split(LINE_ENDINGS);
      }
    }

    shouldInstrument() {
      // TODO: components don't have moduleNames so can't be instrumented.
      return !!this.moduleName &&
        this.exclude.shouldInstrument(this.moduleName);
    }

    currentContainer() {
      return this._containerStack[this._containerStack.length - 1];
    }

    insertHelper(container, node, hash) {
      let children = container.body || container.children;
      let index = children.indexOf(node);
      let b = this.syntax.builders;

      hash.pairs.push(
        b.pair('path', b.string(this.moduleName))
      );

      let helper = b.mustache(
        b.path('ember-cli-code-coverage-increment'),
        null,
        hash
      );
      helper.isCoverageHelper = true;

      container._statementsToInsert = container._statementsToInsert || [];
      container._statementsToInsert.unshift({
        helper,
        index
      });
    }

    insertStatementHelper(node) {
      let b = this.syntax.builders;

      let hash = b.hash([
        b.pair('statement', b.string(this._currentStatement))
      ]);
      this.insertHelper(this.currentContainer(), node, hash);
    }

    insertBranchHelper(container, node, condition) {
      let b = this.syntax.builders;

      let hash = b.hash([
        b.pair('branch', b.string(this._currentBranch)),
        b.pair('condition', b.string(condition))
      ]);

      this.insertHelper(container, node, hash);
    }

    processStatementsToInsert(node) {
      if (node._statementsToInsert) {
        node._statementsToInsert.forEach((statement) => {
          let children = node.children || node.body;
          children.splice(statement.index, 0, statement.helper);
        });
      }
    }

    handleBlock(node) {
      // cannot process blocks without a loc
      if (!node.loc) {
        return;
      }

      if (node.isCoverageHelper) { return; }
      if (this.currentContainer()._ignoreCoverage) { return; }

      this.handleStatement(node);

      if (node.type !== 'BlockStatement') { return; }

      this._currentBranch++;
      this.coverageData.b[this._currentBranch] = [0, 0];
      this.coverageData.branchMap[this._currentBranch] = {
        loc: node.loc,
        type: 'if',
        locations: [
          node.loc,
          node.loc
        ]
      };
      this.insertBranchHelper(node.program, node, 0);
      if (node.inverse) {
        this.insertBranchHelper(node.inverse, node, 1);
      }
    }

    handleStatement(node) {
      if (node.type === 'TextNode' && node.chars.trim() === '') {
        return;
      }

      if (node.isCoverageHelper) { return; }
      if (this.currentContainer()._ignoreCoverage) { return; }

      // cannot process statements without a loc
      if (!node.loc) {
        return;
      }

      if (node.loc.start.line == null) {
        return;
      }

      this._currentStatement++;
      this.coverageData.s[this._currentStatement] = 0;
      this.coverageData.statementMap[this._currentStatement] = node.loc;

      // TODO inline `if` statements
      // if type === if or unless
      // insert inline branch helper
      // {{if isFast "zoooom" "putt-putt-putt"}}
      // {{if (ifHelper isFast) "zoooom" "putt-putt-putt"}}
      // ? {{if not (unlessHelper isFast) "zoooom" "putt-putt-putt"}}

      this.insertStatementHelper(node);
    }

    transform(ast) {
      if (!this.shouldInstrument()) {
        return;
      }

      let handleBlock = {
        enter: (node) => {
          this.handleBlock(node);
          this._containerStack.push(node);
        },
        exit: (node) => {
          this._containerStack.pop();
          this.processStatementsToInsert(node);
        }
      };

      let handleStatement = (node) => this.handleStatement(node);

      let b = this.syntax.builders;

      this.syntax.traverse(ast, {
        Program: {
          enter: (node) => {
            if (!this._topLevelProgram) {
              this._topLevelProgram = node;
              this._containerStack = [node];
            } else {
              this._containerStack.push(node);
            }
          },
          exit: (node) => {
            this.processStatementsToInsert(node);
            if (node === this._topLevelProgram) {
              let helper = b.mustache(
                b.path('ember-cli-code-coverage-register'),
                [
                  // TODO just prettyprint for testing
                  b.string(JSON.stringify(this.coverageData, null, 2))
                ]
              );
              helper.isCoverageHelper = true;

              node.body.unshift(helper);
            } else {
              this._containerStack.pop();
            }
          },
        },

        ElementNode: handleBlock,
        BlockStatement: handleBlock,
        MustacheStatement: handleStatement,
        TextNode: handleStatement,

        AttrNode: {
          enter: (node) => {
            this._containerStack.push(node);
            // cannot properly inject helpers into AttrNode positions
            node._ignoreCoverage = true;
          },

          exit: () => {
            this._containerStack.pop();
          }
        }
      });

      return ast;
    }
  };
};
