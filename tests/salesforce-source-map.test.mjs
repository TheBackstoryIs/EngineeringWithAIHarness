import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseSalesforceMetadata } from '../src/salesforce-source-map.mjs';
import { analyseRepositoryFile, validateSourceMapProfile } from '../src/repository-source-map.mjs';

function names(facts) {
  return facts.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);
}

test('extracts package members and SFDX package directories from allowlisted fields', () => {
  const manifest = analyseSalesforceMetadata('manifest/package.xml', `
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types><members>Invoice__c</members><members>Payment__c</members><name>CustomObject</name></types>
  <types><members>InvoiceService</members><name>ApexClass</name></types>
  <version>66.0</version>
</Package>`);
  assert.equal(names(manifest).includes('salesforce_package:package'), true);
  assert.equal(names(manifest).includes('salesforce_component:CustomObject:Invoice__c'), true);
  assert.equal(names(manifest).includes('salesforce_component:ApexClass:InvoiceService'), true);
  assert.equal(manifest.file.metadata.format_version, '66.0');

  const project = analyseSalesforceMetadata('sfdx-project.json', JSON.stringify({
    packageDirectories: [{ path: 'force-app', default: true }, { path: 'packages/billing' }, { path: '../outside' }],
    namespace: 'PrivateNamespace',
    sfdcLoginUrl: 'https://private.example.invalid'
  }));
  assert.equal(names(project).includes('salesforce_project:sfdx-project'), true);
  assert.equal(names(project).includes('salesforce_package_directory:force-app'), true);
  assert.equal(project.file.metadata.partial, true);
  assert.equal(JSON.stringify(project).includes('../outside'), false);
  assert.equal(JSON.stringify(project).includes('PrivateNamespace'), false);
  assert.equal(JSON.stringify(project).includes('private.example.invalid'), false);
});

test('extracts decomposed object, field, flow and companion identities from safe paths', () => {
  const object = analyseSalesforceMetadata(
    'force-app/main/default/objects/Invoice__c/Invoice__c.object-meta.xml',
    '<CustomObject><label>Private invoices</label><description>Never store this</description></CustomObject>'
  );
  assert.equal(names(object).includes('salesforce_object:Invoice__c'), true);
  assert.equal(JSON.stringify(object).includes('Private invoices'), false);

  const field = analyseSalesforceMetadata(
    'force-app/main/default/objects/Invoice__c/fields/Amount__c.field-meta.xml',
    '<CustomField><fullName>Amount__c</fullName><formula>Secret__c * 2</formula></CustomField>'
  );
  assert.equal(names(field).includes('salesforce_field:Invoice__c.Amount__c'), true);
  assert.equal(field.relationships.some((item) => item.relationship_kind === 'contains'), true);
  assert.equal(JSON.stringify(field).includes('Secret__c * 2'), false);

  const flow = analyseSalesforceMetadata('force-app/main/default/flows/UpdateInvoice.flow-meta.xml', `
<Flow><recordUpdates><name>Update_invoice</name><object>Invoice__c</object>
<filterFormula>Secret__c = "hidden"</filterFormula></recordUpdates></Flow>`);
  assert.equal(names(flow).includes('salesforce_flow:UpdateInvoice'), true);
  assert.equal(flow.relationships.some((item) => item.target_name === 'Invoice__c'), true);
  assert.equal(JSON.stringify(flow).includes('hidden'), false);

  const apex = analyseSalesforceMetadata(
    'force-app/main/default/classes/InvoiceService.cls-meta.xml',
    '<ApexClass><apiVersion>66.0</apiVersion><status>Active</status></ApexClass>'
  );
  assert.equal(names(apex).includes('salesforce_apex_class:InvoiceService'), true);
});

test('preserves permission polarity while excluding labels, endpoints and credentials', () => {
  const facts = analyseSalesforceMetadata('force-app/main/default/permissionsets/Billing.permissionset-meta.xml', `
<PermissionSet>
  <label>Private Billing Team</label>
  <objectPermissions><allowCreate>false</allowCreate><allowDelete>false</allowDelete><allowEdit>true</allowEdit><allowRead>true</allowRead><modifyAllRecords>false</modifyAllRecords><object>Invoice__c</object><viewAllRecords>false</viewAllRecords></objectPermissions>
  <fieldPermissions><editable>false</editable><field>Invoice__c.Secret__c</field><readable>true</readable></fieldPermissions>
  <classAccesses><apexClass>InvoiceService</apexClass><enabled>true</enabled></classAccesses>
  <applicationVisibilities><application>Billing</application><visible>false</visible></applicationVisibilities>
  <tabSettings><tab>Invoice__c</tab><visibility>DefaultOn</visibility></tabSettings>
  <description>Endpoint https://private.example.invalid token super-secret</description>
</PermissionSet>`);

  assert.equal(names(facts).includes('salesforce_permission_set:Billing'), true);
  const objectEdge = facts.relationships.find((item) => item.target_name === 'Invoice__c');
  assert.deepEqual(objectEdge.metadata, {
    platform: 'salesforce',
    allow_create: false,
    allow_delete: false,
    allow_edit: true,
    allow_read: true,
    modify_all_records: false,
    view_all_records: false
  });
  const projection = JSON.stringify(facts);
  for (const forbidden of ['Private Billing Team', 'private.example.invalid', 'super-secret']) {
    assert.equal(projection.includes(forbidden), false);
  }
});

test('dispatches the Salesforce analyser and uses stable malformed-document evidence', () => {
  const profile = validateSourceMapProfile({
    id: 'salesforce',
    patterns: ['**/*.permissionset-meta.xml'],
    analyser: 'salesforce-metadata',
    classification: 'salesforce-metadata'
  });
  const facts = analyseRepositoryFile('permissionsets/Billing.permissionset-meta.xml', {
    buffer: Buffer.from('<PermissionSet><objectPermissions>'),
    profile
  });
  assert.equal(facts.file.analysisOutcome, 'analysis_failed');
  assert.equal(facts.file.metadata.failure_code, 'invalid-platform-document');
  assert.equal(facts.file.metadata.partial, true);
});
