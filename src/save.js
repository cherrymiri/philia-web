import * as THREE from 'three';

// Renders the visitor's real gel at print size, independent of the window.
export function renderStill({ renderer, scene, camera, width, height }) {
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const aspect = camera.aspect;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  renderer.setPixelRatio(ratio);
  renderer.setSize(size.x, size.y, false);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  return out;
}

export function composeCard(still, { title, heading, name, used }) {
  const W = still.width;
  const H = Math.round(W * 1.25);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const u = W / 100;
  const font = (w, s) => `${w} ${s * u}px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.drawImage(still, 0, H * 0.11);
  g.textAlign = 'center';
  g.fillStyle = '#f6f3f7';
  g.font = font(600, 2.6);
  if ('letterSpacing' in g) g.letterSpacing = `${0.5 * u}px`;
  g.fillText(title, W / 2, 7.5 * u);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.fillStyle = '#b9b3bd';
  g.font = font(500, 2.4);
  g.fillText(heading, W / 2, 104 * u);
  g.fillStyle = '#f6f3f7';
  g.font = font(700, 5);
  g.fillText(name, W / 2, 111 * u);
  g.fillStyle = '#b9b3bd';
  g.font = font(400, 1.9);
  g.fillText(used, W / 2, 117 * u, W * 0.9);
  return c;
}

export async function saveCanvas(canvas, filename) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG 생성 실패');
  const file = new File([blob], filename, { type: 'image/png' });
  // iPhone and iPad ignore download links, the share sheet offers "save image".
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
