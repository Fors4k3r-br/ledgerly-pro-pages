// Primitivas criptográficas usadas pela sincronização e pelos backups do Ledgerly.
// A orquestração do Google Drive, armazenamento da chave e interface permanecem no index.html.

const toHex = buffer => Array.from(new Uint8Array(buffer))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function deriveSyncKey(password, salt) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function gzipBytes(bytes, compress) {
  const Stream = compress ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof Stream === 'undefined') throw new Error('Compressão de backup indisponível neste navegador.');
  const stream = new Stream('gzip');
  const writer = stream.writable.getWriter();

  // Consumir a saída antes de escrever evita backpressure: aguardar close()
  // antes de iniciar a leitura pode deixar a escrita bloqueada em alguns browsers.
  const outputPromise = new Response(stream.readable).arrayBuffer();
  try {
    await writer.write(bytes);
    await writer.close();
    return new Uint8Array(await outputPromise);
  } catch (error) {
    try { await writer.abort(error); } catch (_) {}
    throw error;
  }
}

export async function sha256Bytes(bytes) {
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

// Formato preservado: "LGY1" (gzip) | "LGY0" (sem gzip) + salt(16) + iv(12) + AES-GCM.
export async function sealDb(bytes, key, salt) {
  const useGzip = typeof globalThis.CompressionStream !== 'undefined';
  const plain = useGzip ? await gzipBytes(bytes, true) : bytes;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherText = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const output = new Uint8Array(32 + cipherText.length);
  output.set(new TextEncoder().encode(useGzip ? 'LGY1' : 'LGY0'), 0);
  output.set(salt, 4);
  output.set(iv, 20);
  output.set(cipherText, 32);
  return output;
}

export async function openDb(buffer, key) {
  const data = new Uint8Array(buffer);
  const magic = new TextDecoder().decode(data.slice(0, 4));
  if (magic !== 'LGY1' && magic !== 'LGY0') {
    throw new Error('Arquivo da nuvem em formato desconhecido.');
  }
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(20, 32) }, key, data.slice(32)
    ));
  } catch (_) {
    const error = new Error('Senha incorreta ou arquivo corrompido.');
    error.wrongPassword = true;
    throw error;
  }
  return magic === 'LGY1' ? gzipBytes(plain, false) : plain;
}

// Compatibilidade com os handlers clássicos do index.html.
globalThis.deriveSyncKey = deriveSyncKey;
globalThis.gzipBytes = gzipBytes;
globalThis.sha256Bytes = sha256Bytes;
globalThis.sealDb = sealDb;
globalThis.openDb = openDb;

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "toHex", { configurable: true, enumerable: true, get: () => toHex });
Object.defineProperty(globalThis, "deriveSyncKey", { configurable: true, enumerable: true, get: () => deriveSyncKey, set: value => { deriveSyncKey = value; } });
Object.defineProperty(globalThis, "gzipBytes", { configurable: true, enumerable: true, get: () => gzipBytes, set: value => { gzipBytes = value; } });
Object.defineProperty(globalThis, "sha256Bytes", { configurable: true, enumerable: true, get: () => sha256Bytes, set: value => { sha256Bytes = value; } });
Object.defineProperty(globalThis, "sealDb", { configurable: true, enumerable: true, get: () => sealDb, set: value => { sealDb = value; } });
Object.defineProperty(globalThis, "openDb", { configurable: true, enumerable: true, get: () => openDb, set: value => { openDb = value; } });
