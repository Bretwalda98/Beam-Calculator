import './styles.css';

const preference = (() => {
  try {
    return (JSON.parse(localStorage.getItem('beam_ui_settings_v4') || '{}') as { theme?: string }).theme || 'system';
  } catch {
    return 'system';
  }
})();
const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme = dark ? 'dark' : 'light';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/"><span class="mark">BC</span><span>Beam Calculator Studio</span></a>
    <nav><a href="/beam/">Beam EC3</a><a href="/privacy/">Privacy</a></nav>
  </header>
  <main>
    <span class="eyebrow">Three-dimensional analysis</span>
    <h1>Choose a 3D study type.</h1>
    <p class="lead">Frame and solid models use separate schemas, solvers and project state. Select the formulation that represents the physical problem.</p>
    <div class="study-grid">
      <a class="study-card" href="/frame3d/frame/">
        <div class="card-meta"><span class="diagram">1D</span><span class="badge established">Verified foundation</span></div>
        <div>
          <h2>Frame analysis</h2>
          <p>Linear-elastic beams, columns and braces represented by two-node space-frame elements with six degrees of freedom per node.</p>
        </div>
        <span class="open">Open frame workbench →</span>
      </a>
      <a class="study-card solid" href="/frame3d/solid/">
        <div class="card-meta"><span class="diagram">3D</span><span class="badge">Beta platform spike</span></div>
        <div>
          <h2>Solid CAD/FEM</h2>
          <p>Parametric parts, assemblies, tetrahedral continuum models, bonded interfaces and staged frictionless-contact analysis.</p>
        </div>
        <span class="open">Open solid workbench →</span>
      </a>
    </div>
    <aside class="scope-note">
      <strong>Choose carefully.</strong>
      <span>Frame elements model member centre-lines. Solid elements model stress and deformation throughout a three-dimensional volume. Neither is automatically appropriate for every engineering question.</span>
    </aside>
  </main>
  <footer>Results must be reviewed and independently verified before engineering use.</footer>
`;
