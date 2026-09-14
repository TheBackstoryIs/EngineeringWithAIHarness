import { basename } from 'node:path';
import {
  PlatformAnalysisError,
  createPlatformFactCollector,
  normalisePlatformIdentifier,
  normalisePlatformPathIdentifier,
  parseSafePlatformXml,
  parseSafePlatformYaml,
  platformFactsFile,
  xmlChildText,
  xmlDescendants
} from './platform-metadata-analysis.mjs';

const parser = 'ewai-power-platform-metadata/v1';

function normalPath(path) {
  return String(path ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function solutionFromPath(path) {
  return normalPath(path).match(/(?:^|\/)solutions\/([^/]+)\/(?:solution|solutioncomponents|rootcomponents|missingdependencies)\.ya?ml$/i)?.[1] ?? '';
}

function addSolution(collector, solution) {
  if (collector.addSymbol('power_solution', solution)) return solution;
  return '';
}

function addComponent(collector, solution, name, componentType = '') {
  if (!collector.addSymbol('power_component', name, componentType ? { component_type: componentType } : {})) return;
  if (solution) collector.addRelationship('power_solution', solution, 'contains', 'power_component', name);
}

function analyseLegacySolution(path, content) {
  const root = parseSafePlatformXml(content);
  if (root.name.toLowerCase() !== 'importexportxml') throw new PlatformAnalysisError('unsupported-platform-layout');
  const collector = createPlatformFactCollector({ platform: 'power-platform', layout: 'legacy-solution-xml' });
  const manifest = xmlDescendants(root, 'SolutionManifest')[0];
  const solution = addSolution(collector, normalisePlatformIdentifier(xmlChildText(manifest, 'UniqueName')));
  if (!solution) collector.markPartial();
  for (const component of xmlDescendants(manifest, 'RootComponent')) {
    const name = normalisePlatformIdentifier(component.attributes.schemaName ?? component.attributes.id);
    const type = normalisePlatformIdentifier(component.attributes.type);
    if (name) addComponent(collector, solution, name, type);
    else collector.markPartial(1);
  }
  return platformFactsFile(collector.finish(), { language: 'xml', parser, content });
}

function analyseLegacyCustomisations(path, content) {
  const root = parseSafePlatformXml(content);
  const collector = createPlatformFactCollector({ platform: 'power-platform', layout: 'legacy-customisations-xml' });
  let recognised = 0;
  for (const entity of xmlDescendants(root, 'Entity')) {
    const name = normalisePlatformIdentifier(
      entity.attributes.Name ?? entity.attributes.name ?? xmlChildText(entity, 'Name')
    );
    if (!name) continue;
    recognised += 1;
    collector.addSymbol('power_entity', name);
    for (const attribute of xmlDescendants(entity, 'attribute')) {
      const attributeName = normalisePlatformIdentifier(
        attribute.attributes.PhysicalName ?? attribute.attributes.Name ?? xmlChildText(attribute, 'Name')
      );
      if (!attributeName) continue;
      collector.addSymbol('power_attribute', `${name}.${attributeName}`);
      collector.addRelationship('power_entity', name, 'contains', 'power_attribute', `${name}.${attributeName}`);
    }
  }
  if (!recognised) collector.markPartial();
  return platformFactsFile(collector.finish(), { language: 'xml', parser, content });
}

function pathEntries(value, state = { values: [], omitted: 0 }) {
  if (Array.isArray(value)) {
    for (const entry of value) pathEntries(entry, state);
    return state;
  }
  if (!value || typeof value !== 'object') return state;
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase() === 'path') {
      const path = normalisePlatformPathIdentifier(entry);
      if (path) state.values.push(path);
      else state.omitted += 1;
    } else if (entry && typeof entry === 'object') pathEntries(entry, state);
  }
  return state;
}

function componentEntries(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) componentEntries(entry, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  const name = normalisePlatformIdentifier(
    value.SchemaName ?? value.schemaName ?? value.UniqueName ?? value.uniqueName ?? value.Id ?? value.id
  );
  const type = normalisePlatformIdentifier(value.Type ?? value.type);
  if (name) found.push({ name, type });
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === 'object') componentEntries(entry, found);
  }
  return found;
}

function analyseSolutionYaml(path, content) {
  const value = parseSafePlatformYaml(content);
  const file = basename(path).toLowerCase();
  const layout = `solution-${file.replace(/\.ya?ml$/, '')}-yaml`;
  const collector = createPlatformFactCollector({ platform: 'power-platform', layout });
  const solution = addSolution(collector, normalisePlatformIdentifier(solutionFromPath(path)));
  if (!solution) collector.markPartial();
  if (file === 'solutioncomponents.yml') {
    const { values: components, omitted } = pathEntries(value);
    for (const component of components) addComponent(collector, solution, component);
    if (omitted) collector.markPartial(omitted);
    if (!components.length && !omitted) collector.markPartial();
  } else if (file === 'rootcomponents.yml') {
    const components = componentEntries(value);
    for (const component of components) addComponent(collector, solution, component.name, component.type);
    if (!components.length) collector.markPartial();
  } else if (file === 'missingdependencies.yml') {
    const { values: required, omitted } = pathEntries(value?.Required ?? value?.required ?? value?.MissingDependencies ?? value);
    for (const component of required) {
      collector.addSymbol('power_component', component);
      if (solution) collector.addRelationship('power_solution', solution, 'requires', 'power_component', component);
    }
    if (omitted) collector.markPartial(omitted);
    if (!required.length && !omitted) collector.markPartial();
  }
  return platformFactsFile(collector.finish(), { language: 'yaml', parser, content });
}

function canvasChildren(value, parent, collector, depth = 0) {
  if (depth > 96 || !value) return;
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [name, definition] of Object.entries(entry)) {
      const control = normalisePlatformIdentifier(name);
      if (!control || ['Properties', 'Control', 'Variant'].includes(name)) continue;
      collector.addSymbol('power_control', control);
      collector.addRelationship(parent.kind, parent.name, 'contains', 'power_control', control);
      canvasChildren(definition?.Children, { kind: 'power_control', name: control }, collector, depth + 1);
    }
  }
}

function analyseCanvas(path, content) {
  const value = parseSafePlatformYaml(content);
  const collector = createPlatformFactCollector({ platform: 'power-platform', layout: 'canvas-pa-yaml' });
  const filename = basename(path).replace(/\.pa\.ya?ml$/i, '');
  if (value?.App && filename.toLowerCase() === 'app') collector.addSymbol('power_app', filename);
  let recognised = value?.App ? 1 : 0;
  for (const [name, screen] of Object.entries(value?.Screens ?? {})) {
    const screenName = normalisePlatformIdentifier(name);
    if (!screenName) continue;
    recognised += 1;
    collector.addSymbol('power_screen', screenName);
    canvasChildren(screen?.Children, { kind: 'power_screen', name: screenName }, collector);
  }
  for (const [name, component] of Object.entries(value?.Components ?? {})) {
    const componentName = normalisePlatformIdentifier(name);
    if (!componentName) continue;
    recognised += 1;
    collector.addSymbol('power_named_component', componentName);
    canvasChildren(component?.Children, { kind: 'power_named_component', name: componentName }, collector);
  }
  if (!recognised) collector.markPartial();
  return platformFactsFile(collector.finish(), { language: 'yaml', parser, content });
}

export function powerPlatformLayout(path) {
  const value = normalPath(path).toLowerCase();
  if (/(?:^|\/)other\/solution\.xml$/.test(value)) return 'legacy-solution-xml';
  if (/(?:^|\/)other\/customi[sz]ations\.xml$/.test(value)) return 'legacy-customisations-xml';
  if (/(?:^|\/)solutions\/[^/]+\/(?:solution|solutioncomponents|rootcomponents|missingdependencies)\.ya?ml$/.test(value)) return 'solution-yaml';
  if (/(?:^|\/)src\/[^/]+\.pa\.ya?ml$/.test(value) || /(?:^|\/)src\/component\/[^/]+\.pa\.ya?ml$/.test(value)) return 'canvas-pa-yaml';
  return '';
}

export function analysePowerPlatformMetadata(path, content) {
  const layout = powerPlatformLayout(path);
  if (layout === 'legacy-solution-xml') return analyseLegacySolution(path, content);
  if (layout === 'legacy-customisations-xml') return analyseLegacyCustomisations(path, content);
  if (layout === 'solution-yaml') return analyseSolutionYaml(path, content);
  if (layout === 'canvas-pa-yaml') return analyseCanvas(path, content);
  throw new PlatformAnalysisError('unsupported-platform-layout');
}
