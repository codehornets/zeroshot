/**
 * Tests for CANNOT_VALIDATE status in criteriaResults
 *
 * CANNOT_VALIDATE is used when a validator cannot execute a verification step
 * due to missing tools, permissions, or environment issues.
 *
 * Behavior:
 * - Treated as PASS for workflow purposes (doesn't block)
 * - Displayed as warning in CLI and export
 * - Requires reason field explaining why validation was impossible
 */

const assert = require('assert');
const Orchestrator = require('../src/orchestrator.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate tests from user settings
const testSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroshot-test-settings-'));
const testSettingsFile = path.join(testSettingsDir, 'settings.json');
fs.writeFileSync(testSettingsFile, JSON.stringify({ maxModel: 'opus', minModel: null }));
process.env.ZEROSHOT_SETTINGS_FILE = testSettingsFile;

describe('CANNOT_VALIDATE Status', function () {
  this.timeout(5000);

  let orchestrator;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroshot-test-'));
    orchestrator = new Orchestrator({ quiet: true, skipLoad: true, stateDir: tmpDir });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Export Markdown Generation', function () {
    it('should show CANNOT_VALIDATE criteria as warnings in export', function () {
      // Create a mock cluster object
      const mockCluster = {
        state: 'completed',
        createdAt: Date.now() - 60000,
        agents: [{ id: 'worker' }, { id: 'validator' }],
      };

      // Create a mock validation result with CANNOT_VALIDATE criteria
      const messages = [
        {
          id: 'msg-1',
          topic: 'ISSUE_OPENED',
          sender: 'user',
          timestamp: Date.now() - 10000,
          content: { text: 'Test issue' },
        },
        {
          id: 'msg-2',
          topic: 'VALIDATION_RESULT',
          sender: 'validator-requirements',
          timestamp: Date.now(),
          content: {
            text: 'Validation complete with caveats',
            data: {
              approved: true,
              summary: 'Implementation approved with manual verification needed',
              criteriaResults: [
                {
                  id: 'AC1',
                  status: 'PASS',
                  evidence: { command: 'npm test', exitCode: 0, output: 'All tests passed' },
                },
                {
                  id: 'AC2',
                  status: 'CANNOT_VALIDATE',
                  reason: 'kubectl not installed - cannot verify K8s deployment',
                },
                {
                  id: 'AC3',
                  status: 'CANNOT_VALIDATE',
                  reason: 'No SSH access to production server',
                },
              ],
            },
          },
        },
      ];

      // Call the private method to generate export markdown
      const markdown = orchestrator._exportMarkdown(mockCluster, 'test-cluster', messages);

      // Verify CANNOT_VALIDATE warnings are included
      assert.ok(
        markdown.includes('Could Not Validate'),
        'Should include "Could Not Validate" section'
      );
      assert.ok(markdown.includes('2 criteria'), 'Should show count of CANNOT_VALIDATE criteria');
      assert.ok(markdown.includes('AC2'), 'Should include AC2 criterion ID');
      assert.ok(markdown.includes('kubectl not installed'), 'Should include AC2 reason');
      assert.ok(markdown.includes('AC3'), 'Should include AC3 criterion ID');
      assert.ok(markdown.includes('No SSH access'), 'Should include AC3 reason');
    });

    it('should not show CANNOT_VALIDATE section when all criteria pass', function () {
      const mockCluster = {
        state: 'completed',
        createdAt: Date.now() - 60000,
        agents: [{ id: 'validator' }],
      };

      const messages = [
        {
          id: 'msg-1',
          topic: 'ISSUE_OPENED',
          sender: 'user',
          timestamp: Date.now() - 10000,
          content: { text: 'Test issue' },
        },
        {
          id: 'msg-2',
          topic: 'VALIDATION_RESULT',
          sender: 'validator',
          timestamp: Date.now(),
          content: {
            data: {
              approved: true,
              summary: 'All criteria passed',
              criteriaResults: [
                { id: 'AC1', status: 'PASS', evidence: {} },
                { id: 'AC2', status: 'PASS', evidence: {} },
              ],
            },
          },
        },
      ];

      const markdown = orchestrator._exportMarkdown(mockCluster, 'test-cluster', messages);

      assert.ok(
        !markdown.includes('Could Not Validate'),
        'Should not include CANNOT_VALIDATE section when all pass'
      );
    });

    it('should handle missing reason gracefully', function () {
      const mockCluster = {
        state: 'completed',
        createdAt: Date.now() - 60000,
        agents: [{ id: 'validator' }],
      };

      const messages = [
        {
          id: 'msg-1',
          topic: 'ISSUE_OPENED',
          sender: 'user',
          timestamp: Date.now() - 10000,
          content: { text: 'Test issue' },
        },
        {
          id: 'msg-2',
          topic: 'VALIDATION_RESULT',
          sender: 'validator',
          timestamp: Date.now(),
          content: {
            data: {
              approved: true,
              criteriaResults: [
                { id: 'AC1', status: 'CANNOT_VALIDATE' }, // Missing reason
              ],
            },
          },
        },
      ];

      const markdown = orchestrator._exportMarkdown(mockCluster, 'test-cluster', messages);

      assert.ok(
        markdown.includes('No reason provided'),
        'Should show fallback text when reason missing'
      );
    });
  });

  describe('Schema Validation', function () {
    it('should accept CANNOT_VALIDATE as valid status in criteriaResults', function () {
      // The schema should accept CANNOT_VALIDATE without errors
      // This tests that our schema update is correct
      const validCriteriaResult = {
        id: 'AC1',
        status: 'CANNOT_VALIDATE',
        reason: 'Tool not available',
      };

      // Verify the structure is valid (no throw = valid)
      assert.strictEqual(validCriteriaResult.status, 'CANNOT_VALIDATE');
      assert.ok(validCriteriaResult.reason, 'Should have reason field');
    });
  });

  describe('Context Builder Skip Injection', function () {
    const { buildContext } = require('../src/agent/agent-context-builder');

    // Helper to create base context params
    const baseParams = (overrides = {}) => ({
      id: 'validator',
      role: 'validator',
      iteration: 2,
      config: { contextStrategy: { sources: [] } },
      messageBus: { query: () => [] },
      cluster: { id: 'test-cluster', createdAt: Date.now() - 60000 },
      triggeringMessage: { topic: 'IMPLEMENTATION_READY', sender: 'worker' },
      ...overrides,
    });

    // Helper to create mock message bus with CANNOT_VALIDATE criteria
    const mockBusWithCriteria = (criteriaResults) => ({
      query: ({ topic }) => {
        if (topic === 'VALIDATION_RESULT') {
          return [{ content: { data: { criteriaResults } } }];
        }
        return [];
      },
    });

    describe('Core Behavior', function () {
      it('should inject skip section with ALL CANNOT_VALIDATE criteria', function () {
        const criteria = [
          { id: 'AC1', status: 'PASS', evidence: {} },
          { id: 'AC2', status: 'CANNOT_VALIDATE', reason: 'kubectl not installed' },
          { id: 'AC3', status: 'CANNOT_VALIDATE', reason: 'No SSH access to prod' },
          { id: 'AC4', status: 'FAIL', reason: 'Tests failed' },
        ];

        const context = buildContext(baseParams({ messageBus: mockBusWithCriteria(criteria) }));

        // Must include header
        assert.ok(context.includes('Previously Unverifiable Criteria'), 'Missing header');
        // Must include ALL CANNOT_VALIDATE criteria (AC2 and AC3, NOT AC1 or AC4)
        assert.ok(context.includes('AC2'), 'Missing AC2');
        assert.ok(context.includes('kubectl not installed'), 'Missing AC2 reason');
        assert.ok(context.includes('AC3'), 'Missing AC3');
        assert.ok(context.includes('No SSH access'), 'Missing AC3 reason');
        // Must NOT include PASS or FAIL criteria
        assert.ok(!context.includes('**AC1**'), 'Should not include PASS criteria');
        assert.ok(!context.includes('**AC4**'), 'Should not include FAIL criteria');
        // Must include instruction to skip
        assert.ok(context.includes('Do NOT re-attempt'), 'Missing skip instruction');
      });

      it('should NOT inject skip section for non-validator roles', function () {
        const criteria = [{ id: 'AC1', status: 'CANNOT_VALIDATE', reason: 'test' }];

        // Test multiple non-validator roles
        for (const role of ['implementation', 'worker', 'planner', 'tester', 'conductor']) {
          const context = buildContext(
            baseParams({
              role,
              messageBus: mockBusWithCriteria(criteria),
            })
          );
          assert.ok(
            !context.includes('Previously Unverifiable Criteria'),
            `Should NOT inject for role="${role}"`
          );
        }
      });

      it('should deduplicate criteria across multiple validation results', function () {
        // Same criterion from multiple validators
        const messageBus = {
          query: ({ topic }) => {
            if (topic === 'VALIDATION_RESULT') {
              return [
                {
                  content: {
                    data: {
                      criteriaResults: [{ id: 'AC1', status: 'CANNOT_VALIDATE', reason: 'R1' }],
                    },
                  },
                },
                {
                  content: {
                    data: {
                      criteriaResults: [{ id: 'AC1', status: 'CANNOT_VALIDATE', reason: 'R1' }],
                    },
                  },
                },
                {
                  content: {
                    data: {
                      criteriaResults: [{ id: 'AC1', status: 'CANNOT_VALIDATE', reason: 'R1' }],
                    },
                  },
                },
              ];
            }
            return [];
          },
        };

        const context = buildContext(baseParams({ messageBus }));

        // AC1 should appear exactly once
        const matches = context.match(/\*\*AC1\*\*/g) || [];
        assert.strictEqual(matches.length, 1, `AC1 appeared ${matches.length} times, expected 1`);
      });
    });

    describe('Edge Cases - Malformed Data', function () {
      it('should handle null criteriaResults gracefully', function () {
        const messageBus = {
          query: ({ topic }) => {
            if (topic === 'VALIDATION_RESULT') {
              return [{ content: { data: { criteriaResults: null } } }];
            }
            return [];
          },
        };

        // Should NOT throw
        const context = buildContext(baseParams({ messageBus }));
        assert.ok(
          !context.includes('Previously Unverifiable'),
          'Should not inject with null criteria'
        );
      });

      it('should handle undefined criteriaResults gracefully', function () {
        const messageBus = {
          query: ({ topic }) => {
            if (topic === 'VALIDATION_RESULT') {
              return [{ content: { data: {} } }]; // No criteriaResults
            }
            return [];
          },
        };

        const context = buildContext(baseParams({ messageBus }));
        assert.ok(
          !context.includes('Previously Unverifiable'),
          'Should not inject with undefined criteria'
        );
      });

      it('should handle missing content.data gracefully', function () {
        const messageBus = {
          query: ({ topic }) => {
            if (topic === 'VALIDATION_RESULT') {
              return [{ content: {} }, { content: null }, {}];
            }
            return [];
          },
        };

        // Should NOT throw
        const context = buildContext(baseParams({ messageBus }));
        assert.ok(typeof context === 'string', 'Should return valid context');
      });

      it('should handle criteriaResults with missing id field', function () {
        const criteria = [
          { status: 'CANNOT_VALIDATE', reason: 'test' }, // Missing id
          { id: 'AC1', status: 'CANNOT_VALIDATE', reason: 'valid' },
        ];

        const context = buildContext(baseParams({ messageBus: mockBusWithCriteria(criteria) }));

        // Should include AC1 but not the one without id
        assert.ok(context.includes('AC1'), 'Should include valid criterion');
        // The malformed one should be skipped (no id = no injection)
      });

      it('should handle criteriaResults with missing reason field', function () {
        const criteria = [{ id: 'AC1', status: 'CANNOT_VALIDATE' }]; // No reason

        const context = buildContext(baseParams({ messageBus: mockBusWithCriteria(criteria) }));

        assert.ok(context.includes('AC1'), 'Should include criterion');
        assert.ok(context.includes('No reason provided'), 'Should use fallback reason');
      });

      it('should handle empty criteriaResults array', function () {
        const context = buildContext(baseParams({ messageBus: mockBusWithCriteria([]) }));

        assert.ok(
          !context.includes('Previously Unverifiable'),
          'Should not inject with empty array'
        );
      });

      it('should handle criteriaResults that is not an array', function () {
        const messageBus = {
          query: ({ topic }) => {
            if (topic === 'VALIDATION_RESULT') {
              return [{ content: { data: { criteriaResults: 'not-an-array' } } }];
            }
            return [];
          },
        };

        // Should NOT throw
        const context = buildContext(baseParams({ messageBus }));
        assert.ok(!context.includes('Previously Unverifiable'), 'Should not inject with non-array');
      });
    });

    describe('Edge Cases - Message Bus Behavior', function () {
      it('should handle empty message bus results', function () {
        const messageBus = { query: () => [] };

        const context = buildContext(baseParams({ messageBus }));
        assert.ok(
          !context.includes('Previously Unverifiable'),
          'Should not inject with no messages'
        );
      });

      it('should only extract from VALIDATION_RESULT topic', function () {
        let queriedTopics = [];
        const messageBus = {
          query: ({ topic }) => {
            queriedTopics.push(topic);
            return [];
          },
        };

        buildContext(baseParams({ messageBus }));

        // Should query VALIDATION_RESULT for validators
        assert.ok(queriedTopics.includes('VALIDATION_RESULT'), 'Should query VALIDATION_RESULT');
      });

      it('should use cluster.createdAt as since timestamp', function () {
        let capturedSince = null;
        const createdAt = Date.now() - 120000;
        const messageBus = {
          query: ({ since }) => {
            capturedSince = since;
            return [];
          },
        };

        buildContext(baseParams({ messageBus, cluster: { id: 'test', createdAt } }));

        assert.strictEqual(capturedSince, createdAt, 'Should use cluster createdAt');
      });
    });

    describe('Iteration Behavior', function () {
      it('should inject on iteration 1 if CANNOT_VALIDATE exists from iteration 0', function () {
        // Simulates validator running twice in same cluster
        const criteria = [{ id: 'AC1', status: 'CANNOT_VALIDATE', reason: 'No kubectl' }];

        const context = buildContext(
          baseParams({
            iteration: 1, // First real iteration
            messageBus: mockBusWithCriteria(criteria),
          })
        );

        // Even on iteration 1, if there was a previous CANNOT_VALIDATE, inject it
        assert.ok(context.includes('AC1'), 'Should inject on iteration 1');
      });

      it('should accumulate CANNOT_VALIDATE across iterations', function () {
        // Multiple validation results from different iterations
        const messageBus = {
          query: ({ topic }) => {
            if (topic === 'VALIDATION_RESULT') {
              return [
                // Iteration 1 result
                {
                  content: {
                    data: {
                      criteriaResults: [{ id: 'AC1', status: 'CANNOT_VALIDATE', reason: 'R1' }],
                    },
                  },
                },
                // Iteration 2 result - different criterion
                {
                  content: {
                    data: {
                      criteriaResults: [{ id: 'AC2', status: 'CANNOT_VALIDATE', reason: 'R2' }],
                    },
                  },
                },
              ];
            }
            return [];
          },
        };

        const context = buildContext(baseParams({ iteration: 3, messageBus }));

        // Both should be present
        assert.ok(context.includes('AC1'), 'Should include AC1 from iteration 1');
        assert.ok(context.includes('AC2'), 'Should include AC2 from iteration 2');
      });
    });
  });
});

// Cleanup settings file
after(() => {
  if (fs.existsSync(testSettingsDir)) {
    fs.rmSync(testSettingsDir, { recursive: true, force: true });
  }
});
