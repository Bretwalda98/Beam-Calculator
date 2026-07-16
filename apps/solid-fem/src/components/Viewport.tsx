import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface ViewportProps {
  width: number;
  height: number;
  showMesh: boolean;
  showDeformed: boolean;
}

export function Viewport({ width, height, showMesh, showDeformed }: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11151b);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 5000);
    camera.position.set(175, 135, 180);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.current.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 20);

    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x252a32, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(120, 160, 100);
    scene.add(key);

    const geometry = new THREE.BoxGeometry(120, 60, 40, showMesh ? 12 : 1, showMesh ? 6 : 1, showMesh ? 4 : 1);
    if (showDeformed) {
      const positions = geometry.attributes.position;
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const z = positions.getZ(index);
        positions.setZ(index, z - 0.0009 * Math.max(0, x + 60) ** 2);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    }
    const material = new THREE.MeshStandardMaterial({
      color: showDeformed ? 0xf08c46 : 0x3e75c9,
      roughness: 0.46,
      metalness: 0.08,
      transparent: true,
      opacity: showMesh ? 0.88 : 1,
      side: THREE.DoubleSide
    });
    const body = new THREE.Mesh(geometry, material);
    scene.add(body);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, showMesh ? 1 : 20),
      new THREE.LineBasicMaterial({ color: showMesh ? 0xb9d2ff : 0x17253d, transparent: true, opacity: showMesh ? 0.55 : 0.8 })
    );
    scene.add(edges);

    const grid = new THREE.GridHelper(420, 28, 0x42536a, 0x29323f);
    grid.position.y = -42;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(65));

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
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      host.current?.replaceChildren();
    };
  }, [showMesh, showDeformed, width, height]);

  return <div ref={host} className="viewport-canvas" aria-label="Three-dimensional model viewport" />;
}
