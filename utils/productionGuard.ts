/**
 * Production security utilities
 * Prevents sensitive information exposure in production builds
 */

export const isDevelopment = (import.meta as any).env?.DEV || process.env.NODE_ENV === 'development';
export const isProduction = (import.meta as any).env?.PROD || process.env.NODE_ENV === 'production';

/**
 * Safe console logging - only logs in development
 */
export const safeConsole = {
  log: (...args: any[]) => {
    if (isDevelopment) console.log(...args);
  },
  error: (...args: any[]) => {
    if (isDevelopment) console.error(...args);
  },
  warn: (...args: any[]) => {
    if (isDevelopment) console.warn(...args);
  },
  info: (...args: any[]) => {
    if (isDevelopment) console.info(...args);
  },
  debug: (...args: any[]) => {
    if (isDevelopment) console.debug(...args);
  }
};

/**
 * Obfuscate file paths in error messages for production
 */
export const sanitizeError = (error: Error | string): string => {
  if (isDevelopment) return typeof error === 'string' ? error : error.message;
  
  const message = typeof error === 'string' ? error : error.message;
  return message
    .replace(/\/[^\/\s]+\.tsx?/g, '/[component]')
    .replace(/\/[^\/\s]+\.js/g, '/[script]')
    .replace(/line \d+/g, 'line [redacted]')
    .replace(/column \d+/g, 'column [redacted]');
};

/**
 * Safe error boundary fallback
 */
export const getSafeErrorMessage = () => {
  if (isDevelopment) {
    return 'Something went wrong. Check the console for details.';
  }
  return 'Something went wrong. Please refresh the page.';
};
