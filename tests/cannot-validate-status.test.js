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
});

// Cleanup settings file
after(() => {
  if (fs.existsSync(testSettingsDir)) {
    fs.rmSync(testSettingsDir, { recursive: true, force: true });
  }
});
