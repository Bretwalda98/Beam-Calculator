import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CatalogueSectionSnapshot, Sketch, SketchEntity } from '../../../../packages/cad-fem-schema';

interface ViewportProps {
  profile: CatalogueSectionSnapshot | null;
  length: number;
  wireframe: boolean;
  sketch: Sketch | null;
  extrusion: number | null;
}

function addPolygon(shape: THREE.Shape, points: Array<[number, number]>) {
  const [first, ...rest] = points;
  shape.moveTo(first[0], first[1]);
  for (const [x, y] of rest) shape.lineTo(x, y);
  shape.closePath();
}

function roundedRectangle(width: number, height: number, radius: number, clockwise = false): THREE.Shape | THREE.Path {
  const path = clockwise ? new THREE.Path() : new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (clockwise) {
    path.moveTo(x + r, y);
    path.lineTo(x, y);
    path.lineTo(x, y + height - r);
    path.quadraticCurveTo(x, y + height, x + r, y + height);
    path.lineTo(x + width - r, y + height);
    path.quadraticCurveTo(x + width, y + height, x + width, y + height - r);
    path.lineTo(x + width, y + r);
    path.quadraticCurveTo(x + width, y, x + width - r, y);
    path.lineTo(x + r, y);
  } else {
    path.moveTo(x + r, y);
    path.lineTo(x + width - r, y);
    path.quadraticCurveTo(x + width, y, x + width, y + r);
    path.lineTo(x + width, y + height - r);
    path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    path.lineTo(x + r, y + height);
    path.quadraticCurveTo(x, y + height, x, y + height - r);
    path.lineTo(x, y + r);
    path.quadraticCurveTo(x, y, x + r, y);
  }
  path.closePath();
  return path;
}

function sectionShape(profile: CatalogueSectionSnapshot): THREE.Shape {
  const { height: h, width: b, webThickness, flangeThickness, wallThickness, rootRadius, innerRadius } = profile.dimensions;
  if (profile.kind === 'rhs') {
    const t = wallThickness!;
    const shape = roundedRectangle(b, h, rootRadius) as THREE.Shape;
    shape.holes.push(roundedRectangle(b - 2 * t, h - 2 * t, innerRadius ?? Math.max(0, rootRadius - t), true) as THREE.Path);
    return shape;
  }
  const tw = webThickness!;
  const tf = flangeThickness!;
  const shape = new THREE.Shape();
  if (profile.kind === 'channel') {
    addPolygon(shape, [
      [-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf],
      [-b / 2 + tw, -h / 2 + tf], [-b / 2 + tw, h / 2 - tf],
      [b / 2, h / 2 - tf], [b / 2, h / 2], [-b / 2, h / 2]
    ]);
  } else {
    addPolygon(shape, [
      [-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf],
      [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf],
      [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf],
      [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf]
    ]);
  }
  return shape;
}

function sketchPoint(sketch: Sketch, id: string) {
  return sketch.points.find((point) => point.id === id);
}

function sampledEntity(sketch: Sketch, entity: SketchEntity): THREE.Vector3[] {
  if (entity.type === 'line') {
    const start = sketchPoint(sketch, entity.startPointId);
    const end = sketchPoint(sketch, entity.endPointId);
    return start && end ? [new THREE.Vector3(start.x, start.y, 0), new THREE.Vector3(end.x, end.y, 0)] : [];
  }
  if (entity.type === 'circle') {
    const centre = sketchPoint(sketch, entity.centrePointId);
    return centre ? Array.from({ length: 65 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return new THREE.Vector3(centre.x + Math.cos(angle) * entity.radius, centre.y + Math.sin(angle) * entity.radius, 0);
    }) : [];
  }
  const centre = sketchPoint(sketch, entity.centrePointId);
  const start = sketchPoint(sketch, entity.startPointId);
  const end = sketchPoint(sketch, entity.endPointId);
  if (!centre || !start || !end) return [];
  const radius = Math.hypot(start.x - centre.x, start.y - centre.y);
  const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  let endAngle = Math.atan2(end.y - centre.y, end.x - centre.x);
  if (entity.clockwise && endAngle > startAngle) endAngle -= Math.PI * 2;
  if (!entity.clockwise && endAngle < startAngle) endAngle += Math.PI * 2;
  return Array.from({ length: 33 }, (_, index) => {
    const angle = startAngle + (endAngle - startAngle) * index / 32;
    return new THREE.Vector3(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, 0);
  });
}

function sketchShape(sketch: Sketch): THREE.Shape | null {
  const visible = sketch.entities.filter(({ construction }) => !construction);
  if (visible.length === 1 && visible[0].type === 'circle') {
    const circle = visible[0];
    const centre = sketchPoint(sketch, circle.centrePointId);
    if (!centre) return null;
    const shape = new THREE.Shape();
    shape.absarc(centre.x, centre.y, circle.radius, 0, Math.PI * 2, false);
    return shape;
  }
  const lines = visible.filter((entity): entity is Extract<SketchEntity, { type: 'line' }> => entity.type === 'line');
  if (!lines.length) return null;
  const first = sketchPoint(sketch, lines[0].startPointId);
  if (!first) return null;
  const shape = new THREE.Shape();
  shape.moveTo(first.x, first.y);
  let currentId = lines[0].startPointId;
  const remaining = [...lines];
  while (remaining.length) {
    const index = remaining.findIndex((line) => line.startPointId === currentId || line.endPointId === currentId);
    if (index < 0) return null;
    const [line] = remaining.splice(index, 1);
    currentId = line.startPointId === currentId ? line.endPointId : line.startPointId;
    const next = sketchPoint(sketch, currentId);
    if (!next) return null;
    shape.lineTo(next.x, next.y);
  }
  if (currentId !== lines[0].startPointId) return null;
  shape.closePath();
  return shape;
}

export function Viewport({ profile, length, wireframe, sketch, extrusion }: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11151b);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.current.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x252a32, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(1, 2, 2);
    scene.add(key);

    const resources: Array<{ dispose: () => void }> = [];
    const safeLength = Number.isFinite(length) && length > 0 ? length : 1;
    let scale = 500;
    if (sketch) {
      const bounds = new THREE.Box2();
      for (const point of sketch.points) bounds.expandByPoint(new THREE.Vector2(point.x, point.y));
      const extent = new THREE.Vector2();
      bounds.getSize(extent);
      scale = Math.max(50, extent.x, extent.y, extrusion || 0);
      const shape = extrusion ? sketchShape(sketch) : null;
      if (shape && extrusion) {
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: extrusion, bevelEnabled: false, curveSegments: 32 });
        geometry.translate(0, 0, -extrusion / 2);
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: 0x3e75c9, roughness: 0.46, metalness: 0.08, side: THREE.DoubleSide, wireframe
        });
        scene.add(new THREE.Mesh(geometry, material));
        const edgesGeometry = new THREE.EdgesGeometry(geometry, 22);
        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x182944, transparent: true, opacity: 0.85 });
        scene.add(new THREE.LineSegments(edgesGeometry, edgeMaterial));
        resources.push(geometry, material, edgesGeometry, edgeMaterial);
      } else {
        const material = new THREE.LineBasicMaterial({ color: 0x5fa1ff });
        resources.push(material);
        for (const entity of sketch.entities) {
          const points = sampledEntity(sketch, entity);
          if (points.length < 2) continue;
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          scene.add(new THREE.Line(geometry, material));
          resources.push(geometry);
        }
      }
    } else if (profile) {
      const geometry = new THREE.ExtrudeGeometry(sectionShape(profile), {
        depth: safeLength,
        bevelEnabled: false,
        curveSegments: 10
      });
      geometry.translate(0, 0, -safeLength / 2);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: 0x3e75c9,
        roughness: 0.46,
        metalness: 0.08,
        side: THREE.DoubleSide,
        wireframe
      });
      const body = new THREE.Mesh(geometry, material);
      scene.add(body);
      const edgesGeometry = new THREE.EdgesGeometry(geometry, 22);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x182944, transparent: true, opacity: wireframe ? 0.35 : 0.85 });
      scene.add(new THREE.LineSegments(edgesGeometry, edgeMaterial));
      resources.push(geometry, material, edgesGeometry, edgeMaterial);
      scale = Math.max(profile.dimensions.height, profile.dimensions.width, safeLength * 0.45);
    } else {
      const geometry = new THREE.BoxGeometry(260, 160, 3);
      const material = new THREE.MeshBasicMaterial({ color: 0x25303d, wireframe: true, transparent: true, opacity: 0.35 });
      scene.add(new THREE.Mesh(geometry, material));
      resources.push(geometry, material);
    }

    camera.position.set(scale * 1.2, scale * 0.85, scale * 1.35);
    camera.near = Math.max(0.1, scale / 1000);
    camera.far = scale * 20;
    camera.updateProjectionMatrix();
    controls.maxDistance = scale * 8;

    const gridSize = Math.max(500, Math.ceil(scale * 2 / 100) * 100);
    const grid = new THREE.GridHelper(gridSize, 20, 0x42536a, 0x29323f);
    grid.position.y = sketch ? -scale * 0.6 : profile ? -profile.dimensions.height * 0.65 : -110;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(Math.min(scale * 0.35, 250)));

    let frame = 0;
    const resize = () => {
      const rect = host.current!.getBoundingClientRect();
      camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const resource of resources) resource.dispose();
      renderer.dispose();
      host.current?.replaceChildren();
    };
  }, [extrusion, length, profile, sketch, wireframe]);

  const label = sketch ? `Draft preview of ${sketch.name}` : profile ? `Three-dimensional preview of ${profile.designation}` : 'Empty three-dimensional model viewport';
  return <div ref={host} className="viewport-canvas" aria-label={label} />;
}
