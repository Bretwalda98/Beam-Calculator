import { useMemo, useState, type MouseEvent } from 'react';
import type { Sketch, SketchConstraint, SketchEntity } from '../../../../packages/cad-fem-schema';

type DrawMode = 'select' | 'line' | 'circle' | 'arc';

interface SketchEditorProps {
  initial?: Sketch;
  busy: boolean;
  onClose: () => void;
  onSave: (sketch: Sketch) => Promise<void>;
  onSolve: (sketch: Sketch) => Promise<Sketch>;
}

interface PendingPoint {
  id: string;
  x: number;
  y: number;
}

function emptySketch(): Sketch {
  return {
    id: crypto.randomUUID(),
    name: 'Sketch 1',
    plane: { type: 'principal', plane: 'XY', offset: 0 },
    points: [],
    entities: [],
    constraints: [],
    solverState: 'notSolved',
    degreesOfFreedom: null
  };
}

function invalidate(sketch: Sketch) {
  sketch.solverState = 'notSolved';
  sketch.degreesOfFreedom = null;
  delete sketch.solveEvidence;
}

function ensurePoint(sketch: Sketch, x: number, y: number): PendingPoint {
  const snapped = sketch.points.find((point) => Math.hypot(point.x - x, point.y - y) <= 4);
  if (snapped) return snapped;
  const point = { id: crypto.randomUUID(), x, y };
  sketch.points.push(point);
  return point;
}

function arcPath(sketch: Sketch, entity: Extract<SketchEntity, { type: 'arc' }>): string {
  const centre = sketch.points.find(({ id }) => id === entity.centrePointId);
  const start = sketch.points.find(({ id }) => id === entity.startPointId);
  const end = sketch.points.find(({ id }) => id === entity.endPointId);
  if (!centre || !start || !end) return '';
  const radius = Math.hypot(start.x - centre.x, start.y - centre.y);
  let startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
  if (entity.clockwise && endAngle > startAngle) endAngle -= Math.PI * 2;
  if (!entity.clockwise && endAngle < startAngle) endAngle += Math.PI * 2;
  const points = Array.from({ length: 25 }, (_, index) => {
    const angle = startAngle + (endAngle - startAngle) * index / 24;
    return `${centre.x + Math.cos(angle) * radius},${-(centre.y + Math.sin(angle) * radius)}`;
  });
  return `M ${points.join(' L ')}`;
}

function constraintLabel(constraint: SketchConstraint): string {
  const value = 'value' in constraint ? ` ${constraint.value} mm` :
    'valueRad' in constraint ? ` ${(constraint.valueRad * 180 / Math.PI).toFixed(1)}°` : '';
  return `${constraint.type}${value}`;
}

export function SketchEditor({ initial, busy, onClose, onSave, onSolve }: SketchEditorProps) {
  const [sketch, setSketch] = useState<Sketch>(() => structuredClone(initial || emptySketch()));
  const [mode, setMode] = useState<DrawMode>('line');
  const [pending, setPending] = useState<PendingPoint[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [dimension, setDimension] = useState(40);
  const [message, setMessage] = useState('Draw in millimetres. Existing points snap within 4 mm.');
  const selectedEntity = sketch.entities.find(({ id }) => id === selectedEntityId);
  const evidence = sketch.solveEvidence;
  const entityMap = useMemo(() => new Map(sketch.entities.map((entity) => [entity.id, entity])), [sketch.entities]);

  const point = (id: string) => sketch.points.find((candidate) => candidate.id === id);

  const selectMode = (next: DrawMode) => {
    setMode(next);
    setPending([]);
    setMessage(next === 'select' ? 'Select geometry to add a constraint or delete it.' : `Click the sketch plane to draw a ${next}.`);
  };

  const canvasPoint = (event: MouseEvent<SVGSVGElement>) => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round((-150 + (event.clientX - rectangle.left) / rectangle.width * 300) * 2) / 2,
      y: Math.round((100 - (event.clientY - rectangle.top) / rectangle.height * 200) * 2) / 2
    };
  };

  const draw = (event: MouseEvent<SVGSVGElement>) => {
    if (mode === 'select') {
      setSelectedEntityId('');
      return;
    }
    const coordinate = canvasPoint(event);
    const next = structuredClone(sketch);
    invalidate(next);
    if (mode === 'line') {
      const current = ensurePoint(next, coordinate.x, coordinate.y);
      if (!pending.length) {
        setPending([current]);
        setSketch(next);
        setMessage('Choose the line end point.');
        return;
      }
      if (current.id !== pending[0].id) {
        next.entities.push({
          id: crypto.randomUUID(), type: 'line', startPointId: pending[0].id,
          endPointId: current.id, construction: false
        });
      }
      setPending([]);
      setSketch(next);
      setMessage('Line added. Choose another start point.');
      return;
    }
    if (mode === 'circle') {
      if (!pending.length) {
        const centre = ensurePoint(next, coordinate.x, coordinate.y);
        setPending([centre]);
        setSketch(next);
        setMessage('Choose a point on the circumference.');
        return;
      }
      const radius = Math.hypot(coordinate.x - pending[0].x, coordinate.y - pending[0].y);
      if (radius > 0.1) {
        next.entities.push({
          id: crypto.randomUUID(), type: 'circle', centrePointId: pending[0].id,
          radius, construction: false
        });
      }
      setPending([]);
      setSketch(next);
      setMessage('Circle added. Choose another centre point.');
      return;
    }
    const current = ensurePoint(next, coordinate.x, coordinate.y);
    if (pending.length < 2) {
      setPending([...pending, current]);
      setSketch(next);
      setMessage(pending.length === 0 ? 'Choose the arc start point.' : 'Choose the arc end point.');
      return;
    }
    if (new Set([pending[0].id, pending[1].id, current.id]).size === 3) {
      next.entities.push({
        id: crypto.randomUUID(), type: 'arc', centrePointId: pending[0].id,
        startPointId: pending[1].id, endPointId: current.id,
        clockwise: false, construction: false
      });
    }
    setPending([]);
    setSketch(next);
    setMessage('Arc added. Choose another centre point.');
  };

  const addConstraint = (type: 'horizontal' | 'vertical' | 'fixed' | 'dimension') => {
    if (!selectedEntity) {
      setMessage('Select an entity first.');
      return;
    }
    let constraint: SketchConstraint | null = null;
    if ((type === 'horizontal' || type === 'vertical') && selectedEntity.type === 'line') {
      constraint = { id: crypto.randomUUID(), type, entityId: selectedEntity.id };
    } else if (type === 'fixed') {
      const pointId = selectedEntity.type === 'circle' ? selectedEntity.centrePointId :
        selectedEntity.type === 'arc' ? selectedEntity.centrePointId : selectedEntity.startPointId;
      constraint = { id: crypto.randomUUID(), type: 'fixed', pointId };
    } else if (type === 'dimension' && selectedEntity.type === 'line') {
      constraint = {
        id: crypto.randomUUID(), type: 'distance', pointA: selectedEntity.startPointId,
        pointB: selectedEntity.endPointId, value: dimension
      };
    } else if (type === 'dimension' && (selectedEntity.type === 'circle' || selectedEntity.type === 'arc')) {
      constraint = { id: crypto.randomUUID(), type: 'radius', entityId: selectedEntity.id, value: dimension };
    }
    if (!constraint) {
      setMessage('That constraint does not apply to the selected geometry.');
      return;
    }
    const next = structuredClone(sketch);
    next.constraints.push(constraint);
    invalidate(next);
    setSketch(next);
    setMessage(`${constraint.type} constraint added. Run the native solve to apply it.`);
  };

  const removeSelected = () => {
    if (!selectedEntity) return;
    const next = structuredClone(sketch);
    next.entities = next.entities.filter(({ id }) => id !== selectedEntity.id);
    next.constraints = next.constraints.filter((constraint) => !JSON.stringify(constraint).includes(selectedEntity.id));
    invalidate(next);
    setSketch(next);
    setSelectedEntityId('');
    setMessage('Entity deleted. Unused points remain available for snapping.');
  };

  const runNativeSolve = async () => {
    try {
      setMessage('Sending this sketch to the native Ceres kernel…');
      const solved = await onSolve(sketch);
      setSketch(solved);
      setMessage(`Native Ceres result: ${solved.solverState}${solved.degreesOfFreedom === null ? '' : `, ${solved.degreesOfFreedom} degrees of freedom`}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return <div className="sketch-overlay" role="dialog" aria-modal="true" aria-labelledby="sketch-title">
    <div className="sketch-dialog">
      <header>
        <div><strong id="sketch-title">Sketch workbench</strong><span>Draft geometry is local until saved; constraints are authoritative only after Ceres solves them.</span></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close sketch workbench">×</button>
      </header>
      <div className="sketch-toolbar" aria-label="Sketch tools">
        {(['select', 'line', 'circle', 'arc'] as DrawMode[]).map((tool) =>
          <button type="button" className={mode === tool ? 'active' : ''} onClick={() => selectMode(tool)} key={tool}>{tool}</button>)}
        <span className="toolbar-divider" />
        <button type="button" disabled={!selectedEntity} onClick={() => addConstraint('horizontal')}>Horizontal</button>
        <button type="button" disabled={!selectedEntity} onClick={() => addConstraint('vertical')}>Vertical</button>
        <button type="button" disabled={!selectedEntity} onClick={() => addConstraint('fixed')}>Fix point</button>
        <label>Dimension [mm]<input type="number" min="0.001" step="1" value={dimension} onChange={(event) => setDimension(Number(event.target.value))} /></label>
        <button type="button" disabled={!selectedEntity || !(dimension > 0)} onClick={() => addConstraint('dimension')}>Add dimension</button>
        <button type="button" className="danger" disabled={!selectedEntity} onClick={removeSelected}>Delete</button>
      </div>
      <div className="sketch-body">
        <div className="sketch-canvas-wrap">
          <svg className="sketch-canvas" viewBox="-150 -100 300 200" onClick={draw} aria-label="Sketch plane, 300 by 200 millimetres">
            <defs><pattern id="minor-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" /></pattern></defs>
            <rect x="-150" y="-100" width="300" height="200" className="sketch-grid" />
            <line x1="-150" y1="0" x2="150" y2="0" className="sketch-axis" />
            <line x1="0" y1="-100" x2="0" y2="100" className="sketch-axis" />
            {sketch.entities.map((entity) => {
              const selected = entity.id === selectedEntityId;
              const common = { className: `sketch-entity ${selected ? 'selected' : ''}`, onClick: (event: MouseEvent<SVGElement>) => { event.stopPropagation(); setSelectedEntityId(entity.id); setMode('select'); } };
              if (entity.type === 'line') {
                const start = point(entity.startPointId); const end = point(entity.endPointId);
                return start && end ? <line {...common} key={entity.id} x1={start.x} y1={-start.y} x2={end.x} y2={-end.y} /> : null;
              }
              if (entity.type === 'circle') {
                const centre = point(entity.centrePointId);
                return centre ? <circle {...common} key={entity.id} cx={centre.x} cy={-centre.y} r={entity.radius} /> : null;
              }
              return <path {...common} key={entity.id} d={arcPath(sketch, entity)} />;
            })}
            {sketch.points.map((candidate) => <circle className="sketch-point" key={candidate.id} cx={candidate.x} cy={-candidate.y} r="1.7" />)}
            {pending.map((candidate) => <circle className="sketch-pending" key={candidate.id} cx={candidate.x} cy={-candidate.y} r="3" />)}
          </svg>
          <div className="sketch-message" role="status">{message}</div>
        </div>
        <aside className="sketch-inspector">
          <label>Name<input value={sketch.name} onChange={(event) => setSketch((current) => ({ ...current, name: event.target.value }))} /></label>
          <dl>
            <div><dt>Plane</dt><dd>{sketch.plane.type === 'principal' ? sketch.plane.plane : 'Referenced face'}</dd></div>
            <div><dt>Points</dt><dd>{sketch.points.length}</dd></div>
            <div><dt>Entities</dt><dd>{sketch.entities.length}</dd></div>
            <div><dt>Solver state</dt><dd>{sketch.solverState}</dd></div>
            <div><dt>Degrees of freedom</dt><dd>{sketch.degreesOfFreedom ?? 'Not solved'}</dd></div>
          </dl>
          <h3>Constraints</h3>
          <div className="constraint-list">
            {sketch.constraints.map((constraint) => <div key={constraint.id}><span>{constraintLabel(constraint)}</span><button type="button" aria-label={`Delete ${constraint.type} constraint`} onClick={() => { const next = structuredClone(sketch); next.constraints = next.constraints.filter(({ id }) => id !== constraint.id); invalidate(next); setSketch(next); }}>×</button></div>)}
            {!sketch.constraints.length && <p>No constraints yet.</p>}
          </div>
          {evidence && <div className={`solve-evidence ${sketch.solverState}`}>
            <strong>Ceres {evidence.kernelVersion}</strong>
            <span>Rank {evidence.jacobianRank}/{evidence.variableCount}</span>
            <span>Maximum residual {evidence.maximumResidual.toExponential(2)}</span>
          </div>}
        </aside>
      </div>
      <footer>
        <span>SI-derived project units: mm and radians</span>
        <button type="button" disabled={busy || sketch.entities.length === 0} onClick={() => void runNativeSolve()}>Solve constraints with Ceres</button>
        <button className="primary" type="button" disabled={busy || sketch.entities.length === 0 || !sketch.name.trim()} onClick={() => void onSave(sketch)}>Save sketch revision</button>
      </footer>
    </div>
  </div>;
}
