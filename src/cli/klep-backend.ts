import kerror from './kerror.ts';


let backend: any;

export default async function get() {
  try {
    if (!backend) {
      backend = (await import('../rust/pkg/kleptool_rust.js')).default;
    }
    return backend;
  } catch (e) {
    throw kerror(kerror.Unknown, 'backend-not-found', {
      message: 'Klep backend not found. Likely, the rust backend is not built',
      context: {
        error: e instanceof Error ? e.message : 'Unknown error',
        stack: e instanceof Error ? e.stack : undefined,
      },
    });
  }
}