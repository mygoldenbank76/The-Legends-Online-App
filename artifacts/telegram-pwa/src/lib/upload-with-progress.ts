export type UploadProgress = {
  loaded: number;
  total: number;
};

export type UploadOptions = {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

export class UploadAbortError extends Error {
  constructor() {
    super('Upload aborted');
    this.name = 'UploadAbortError';
  }
}

export function uploadFileWithProgress<T = unknown>(
  url: string,
  file: File,
  fieldName: string = 'file',
  options: UploadOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append(fieldName, file);

    xhr.open('POST', url);

    const token = localStorage.getItem('telechat_token');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) {
        options.onProgress({ loaded: e.loaded, total: e.total });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          resolve(data as T);
        } catch (err) {
          reject(new Error('Réponse serveur invalide'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Erreur réseau'));
    xhr.onabort = () => reject(new UploadAbortError());

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new UploadAbortError());
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}
