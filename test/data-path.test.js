const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  migrateLegacyInstallDatengrube,
  MIGRATION_MARKER
} = require('../lib/data-path');

describe('data-path migration', () => {
  it('kopiert fehlende Dateien aus Legacy-Installationsordner', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-dg-'));
    const legacy = path.join(root, 'legacy');
    const target = path.join(root, 'target');
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(legacy, '1262026Chat_de.csv'), 'a;b;c\n', 'utf8');
    fs.writeFileSync(path.join(target, 'ChatBlueprints.txt'), 'hello\n', 'utf8');

    const result = migrateLegacyInstallDatengrube(target, legacy);
    assert.equal(result.migrated, 1);
    assert.ok(fs.existsSync(path.join(target, '1262026Chat_de.csv')));
    assert.ok(fs.existsSync(path.join(target, MIGRATION_MARKER)));
    assert.ok(fs.existsSync(path.join(target, 'ChatBlueprints.txt')));
  });
});
