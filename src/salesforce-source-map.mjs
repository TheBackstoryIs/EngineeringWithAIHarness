import { basename } from 'node:path';
import {
  PlatformAnalysisError,
  assertBoundedPlatformStructure,
  createPlatformFactCollector,
  normalisePlatformIdentifier,
  normalisePlatformPathIdentifier,
  parseSafePlatformXml,
  platformBoolean,
  platformFactsFile,
  xmlChildText,
  xmlChildren,
  xmlDescendants
} from './platform-metadata-analysis.mjs';

const parser = 'ewai-salesforce-metadata/v1';

function normalPath(path) {
  return String(path ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function stem(path, suffix) {
  return basename(path).slice(0, -suffix.length);
}

function analysePackage(path, content) {
  const root = parseSafePlatformXml(content);
  if (root.name.toLowerCase() !== 'package') throw new PlatformAnalysisError('unsupported-platform-layout');
  const collector = createPlatformFactCollector({ platform: 'salesforce', layout: 'metadata-package-xml' });
  const packageName = 'package';
  collector.addSymbol('salesforce_package', packageName);
  for (const type of xmlChildren(root, 'types')) {
    const typeName = normalisePlatformIdentifier(xmlChildText(type, 'name'));
    if (!typeName) {
      collector.markPartial();
      continue;
    }
    for (const member of xmlChildren(type, 'members')) {
      const memberName = normalisePlatformIdentifier(member.text);
      if (!memberName) continue;
      const componentName = `${typeName}:${memberName}`;
      collector.addSymbol('salesforce_component', componentName, { component_type: typeName });
      collector.addRelationship('salesforce_package', packageName, 'contains', 'salesforce_component', componentName);
    }
  }
  return platformFactsFile(collector.finish({ format_version: xmlChildText(root, 'version') }), {
    language: 'xml', parser, content
  });
}

function analyseProject(content) {
  let value;
  try {
    value = JSON.parse(String(content ?? '').replace(/^\uFEFF/, ''));
    assertBoundedPlatformStructure(value);
  } catch (error) {
    if (error instanceof PlatformAnalysisError) throw error;
    throw new PlatformAnalysisError('invalid-platform-document');
  }
  const collector = createPlatformFactCollector({ platform: 'salesforce', layout: 'sfdx-project-json' });
  collector.addSymbol('salesforce_project', 'sfdx-project');
  for (const entry of Array.isArray(value.packageDirectories) ? value.packageDirectories : []) {
    const directory = normalisePlatformPathIdentifier(entry?.path);
    if (!directory) {
      collector.markPartial(1);
      continue;
    }
    collector.addSymbol('salesforce_package_directory', directory);
    collector.addRelationship('salesforce_project', 'sfdx-project', 'contains', 'salesforce_package_directory', directory);
  }
  return platformFactsFile(collector.finish(), { language: 'json', parser, content });
}

function analyseObject(path, content) {
  parseSafePlatformXml(content);
  const object = normalPath(path).match(/(?:^|\/)objects\/([^/]+)\/[^/]+\.object-meta\.xml$/i)?.[1];
  const collector = createPlatformFactCollector({ platform: 'salesforce', layout: 'decomposed-custom-object' });
  if (object) collector.addSymbol('salesforce_object', object);
  else collector.markPartial();
  return platformFactsFile(collector.finish(), { language: 'xml', parser, content });
}

function analyseField(path, content) {
  const root = parseSafePlatformXml(content);
  const match = normalPath(path).match(/(?:^|\/)objects\/([^/]+)\/fields\/([^/]+)\.field-meta\.xml$/i);
  const object = normalisePlatformIdentifier(match?.[1]);
  const field = normalisePlatformIdentifier(xmlChildText(root, 'fullName') || match?.[2]);
  const collector = createPlatformFactCollector({ platform: 'salesforce', layout: 'decomposed-custom-field' });
  if (object && field) {
    const qualified = field.includes('.') ? field : `${object}.${field}`;
    collector.addSymbol('salesforce_object', object);
    collector.addSymbol('salesforce_field', qualified);
    collector.addRelationship('salesforce_object', object, 'contains', 'salesforce_field', qualified);
  } else collector.markPartial();
  return platformFactsFile(collector.finish(), { language: 'xml', parser, content });
}

function booleanMetadata(node, fields) {
  const metadata = {};
  for (const [xml, output] of fields) {
    const parsed = platformBoolean(xmlChildText(node, xml));
    if (parsed !== null) metadata[output] = parsed;
  }
  return metadata;
}

function analysePermissions(path, content, layout, kind, suffix) {
  const root = parseSafePlatformXml(content);
  const name = normalisePlatformIdentifier(stem(path, suffix));
  const collector = createPlatformFactCollector({ platform: 'salesforce', layout });
  if (!name) collector.markPartial();
  else collector.addSymbol(kind, name);

  const addAccess = (element, targetElement, targetKind, relationshipKind, metadata = {}) => {
    const target = normalisePlatformIdentifier(xmlChildText(element, targetElement));
    if (!name || !target) return;
    collector.addSymbol(targetKind, target);
    collector.addRelationship(kind, name, relationshipKind, targetKind, target, metadata);
  };
  for (const item of xmlDescendants(root, 'objectPermissions')) {
    addAccess(item, 'object', 'salesforce_object', 'object_permission', booleanMetadata(item, [
      ['allowCreate', 'allow_create'], ['allowDelete', 'allow_delete'], ['allowEdit', 'allow_edit'],
      ['allowRead', 'allow_read'], ['modifyAllRecords', 'modify_all_records'], ['viewAllRecords', 'view_all_records']
    ]));
  }
  for (const item of xmlDescendants(root, 'fieldPermissions')) {
    addAccess(item, 'field', 'salesforce_field', 'field_permission', booleanMetadata(item, [
      ['editable', 'editable'], ['readable', 'readable']
    ]));
  }
  for (const item of xmlDescendants(root, 'classAccesses')) {
    addAccess(item, 'apexClass', 'salesforce_apex_class', 'apex_class_access', booleanMetadata(item, [['enabled', 'enabled']]));
  }
  for (const item of xmlDescendants(root, 'applicationVisibilities')) {
    addAccess(item, 'application', 'salesforce_application', 'application_visibility', booleanMetadata(item, [['visible', 'visible']]));
  }
  for (const item of xmlDescendants(root, 'tabSettings')) {
    addAccess(item, 'tab', 'salesforce_tab', 'tab_visibility', { visibility: xmlChildText(item, 'visibility') });
  }
  return platformFactsFile(collector.finish(), { language: 'xml', parser, content });
}

function analyseFlow(path, content) {
  const root = parseSafePlatformXml(content);
  const name = normalisePlatformIdentifier(stem(path, '.flow-meta.xml'));
  const collector = createPlatformFactCollector({ platform: 'salesforce', layout: 'flow-metadata' });
  if (name) collector.addSymbol('salesforce_flow', name);
  else collector.markPartial();
  for (const [element, relationship] of [
    ['recordCreates', 'creates_records'],
    ['recordLookups', 'reads_records'],
    ['recordUpdates', 'updates_records'],
    ['recordDeletes', 'deletes_records']
  ]) {
    for (const operation of xmlDescendants(root, element)) {
      const object = normalisePlatformIdentifier(xmlChildText(operation, 'object'));
      if (!name || !object) continue;
      collector.addSymbol('salesforce_object', object);
      collector.addRelationship('salesforce_flow', name, relationship, 'salesforce_object', object);
    }
  }
  return platformFactsFile(collector.finish(), { language: 'xml', parser, content });
}

function analyseCompanion(path, content) {
  parseSafePlatformXml(content);
  const value = normalPath(path);
  let kind = '';
  let name = '';
  let layout = '';
  const apex = value.match(/(?:^|\/)classes\/([^/]+)\.cls-meta\.xml$/i);
  const lightning = value.match(/(?:^|\/)(lwc|aura)\/([^/]+)\/[^/]+\.(?:js|cmp|app|evt)-meta\.xml$/i);
  if (apex) {
    kind = 'salesforce_apex_class';
    name = apex[1];
    layout = 'apex-companion';
  } else if (lightning) {
    kind = lightning[1].toLowerCase() === 'lwc' ? 'salesforce_lwc' : 'salesforce_aura';
    name = lightning[2];
    layout = 'lightning-companion';
  }
  if (!kind || !name) throw new PlatformAnalysisError('unsupported-platform-layout');
  const collector = createPlatformFactCollector({ platform: 'salesforce', layout });
  collector.addSymbol(kind, name);
  return platformFactsFile(collector.finish(), { language: 'xml', parser, content });
}

export function salesforceLayout(path) {
  const value = normalPath(path).toLowerCase();
  if (/(?:^|\/)(?:manifest\/|unpackaged\/)?package\.xml$/.test(value)) return 'metadata-package-xml';
  if (/(?:^|\/)sfdx-project\.json$/.test(value)) return 'sfdx-project-json';
  if (/\.object-meta\.xml$/.test(value)) return 'decomposed-custom-object';
  if (/\.field-meta\.xml$/.test(value)) return 'decomposed-custom-field';
  if (/\.permissionset-meta\.xml$/.test(value)) return 'permission-set-metadata';
  if (/\.profile-meta\.xml$/.test(value)) return 'profile-metadata';
  if (/\.flow-meta\.xml$/.test(value)) return 'flow-metadata';
  if (/\.cls-meta\.xml$/.test(value) || /(?:^|\/)(?:lwc|aura)\/[^/]+\/[^/]+\.(?:js|cmp|app|evt)-meta\.xml$/.test(value)) return 'component-companion';
  return '';
}

export function analyseSalesforceMetadata(path, content) {
  const layout = salesforceLayout(path);
  if (layout === 'metadata-package-xml') return analysePackage(path, content);
  if (layout === 'sfdx-project-json') return analyseProject(content);
  if (layout === 'decomposed-custom-object') return analyseObject(path, content);
  if (layout === 'decomposed-custom-field') return analyseField(path, content);
  if (layout === 'permission-set-metadata') return analysePermissions(path, content, layout, 'salesforce_permission_set', '.permissionset-meta.xml');
  if (layout === 'profile-metadata') return analysePermissions(path, content, layout, 'salesforce_profile', '.profile-meta.xml');
  if (layout === 'flow-metadata') return analyseFlow(path, content);
  if (layout === 'component-companion') return analyseCompanion(path, content);
  throw new PlatformAnalysisError('unsupported-platform-layout');
}
