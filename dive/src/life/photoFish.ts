import * as THREE from 'three';
import { PHOTO_PROFILES } from './photoProfiles';

// Photo textures (public-domain / CC0, see src/assets/fish/CREDITS.md), keyed by species id.
const urls = import.meta.glob('../assets/fish/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const TEX: Record<string, string> = {};
for (const [k, v] of Object.entries(urls)) TEX[k.split('/').pop()!.replace('.webp', '')] = v;

const loader = new THREE.TextureLoader();

export function photoFor(id: string): { url: string; aspect: number; prof: number[][] } | null {
  const p = PHOTO_PROFILES[id];
  const url = TEX[id];
  return p && url ? { url, ...p } : null;
}

export function loadPhotoTex(url: string): THREE.Texture {
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
