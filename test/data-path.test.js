const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  migrateLegacyInstallDatengrube,
  migrateFlatRootToSiteDirs,
  MIGRATION_MARKER,
  SITE_SPLIT_MARKER
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

  it('legt com/eu an und sortiert Flat-Dateien (EU-Logs → eu/)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-sites-'));
    fs.writeFileSync(path.join(root, 'HashIP_All.csv'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(root, '382026Chat_de.csv'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(root, '382026Chat_eu.csv'), 'b\n', 'utf8');
    fs.writeFileSync(path.join(root, 'Veri2Users.txt'), 'x\n', 'utf8');
    fs.mkdirSync(path.join(root, 'NotifySounds'), { recursive: true });

    const result = migrateFlatRootToSiteDirs(root);
    assert.ok(result.moved >= 3);
    assert.ok(fs.existsSync(path.join(root, SITE_SPLIT_MARKER)));
    assert.ok(fs.existsSync(path.join(root, 'com', 'HashIP_All.csv')));
    assert.ok(fs.existsSync(path.join(root, 'com', '382026Chat_de.csv')));
    assert.ok(fs.existsSync(path.join(root, 'com', 'Veri2Users.txt')));
    assert.ok(fs.existsSync(path.join(root, 'eu', '382026Chat_eu.csv')));
    assert.ok(fs.existsSync(path.join(root, 'NotifySounds')));
    assert.ok(!fs.existsSync(path.join(root, 'HashIP_All.csv')));
  });
});
