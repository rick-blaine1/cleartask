const devLog = (...args: any[]) => {
  if (!import.meta.env.PROD) {
    console.log('[DEV]', ...args);
  }
};

const devError = (...args: any[]) => {
  if (!import.meta.env.PROD) {
    console.error('[DEV]', ...args);
  }
};

export { devLog, devError };