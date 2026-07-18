import type { CadRevisionSummary, PartFeature } from '../../../../packages/cad-fem-schema';

interface RevisionTimelineProps {
  features: PartFeature[];
  revisions: CadRevisionSummary[];
  currentRevision: number;
  busy: boolean;
  onSelectFeature: (feature: PartFeature) => void;
  onRestore: (revision: number) => Promise<void>;
}

function commandName(commandType: CadRevisionSummary['commandType']): string {
  const names: Partial<Record<NonNullable<CadRevisionSummary['commandType']>, string>> = {
    renameProject: 'Rename project',
    appendCatalogueExtrusion: 'Insert EC3 section',
    upsertSketch: 'Save sketch',
    deleteSketch: 'Delete sketch',
    appendFeature: 'Add feature',
    updateFeature: 'Edit feature',
    deleteFeature: 'Delete feature',
    suppressFeature: 'Suppress feature',
    upsertComponent: 'Edit component',
    upsertMate: 'Edit mate',
    upsertMaterial: 'Edit material',
    upsertStudy: 'Edit study',
    restoreRevision: 'Restore model'
  };
  return commandType ? names[commandType] || commandType : 'Project created';
}

export function RevisionTimeline({
  features, revisions, currentRevision, busy, onSelectFeature, onRestore
}: RevisionTimelineProps) {
  return <section className="timeline-panel" aria-label="Feature and revision timeline">
    <div className="timeline-heading"><strong>Feature timeline</strong><span>{features.length} features</span></div>
    <div className="feature-strip">
      {features.map((feature, index) => <button
        type="button"
        key={feature.id}
        className={feature.suppressed ? 'suppressed' : ''}
        onClick={() => onSelectFeature(feature)}
      ><span>{index + 1}</span>{feature.name}<small>{feature.regenerationState || 'legacy'}</small></button>)}
      {!features.length && <p>Sketches and features will appear here in regeneration order.</p>}
    </div>
    <details>
      <summary>Immutable project history ({revisions.length})</summary>
      <div className="revision-list">
        {[...revisions].reverse().map((revision) => <div key={revision.revision}>
          <span><strong>r{revision.revision}</strong>{commandName(revision.commandType)}{revision.targetRevision === undefined ? '' : ` from r${revision.targetRevision}`}</span>
          <button type="button" disabled={busy || revision.revision >= currentRevision} onClick={() => void onRestore(revision.revision)}>Restore</button>
        </div>)}
      </div>
    </details>
  </section>;
}
