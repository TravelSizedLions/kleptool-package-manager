/**
 * Windows Path Simulation Test Setup
 *
 * This module automatically enables Windows path simulation when the
 * KLEP_SIMULATE_WINDOWS environment variable is set.
 */

import windowsSimulator from '../utils/windows-path-simulator.ts';

// Check if Windows simulation should be enabled (but not if we're actually on Windows)
if (process.env.KLEP_SIMULATE_WINDOWS === '1' && process.platform !== 'win32') {
  console.log('🪟 Windows path simulation enabled for testing');
  windowsSimulator.enableWindowsPathSimulation();

  // Make the Windows path mock available globally for easy access in tests
  (globalThis as unknown as { mockWindowsPaths?: () => boolean }).mockWindowsPaths = () => {
    if (typeof global !== 'undefined' && 'moxxy' in global) {
      const moxxy = (global as unknown as { moxxy?: { path?: { mock?: (mock: unknown) => void } } })
        .moxxy;
      if (moxxy && typeof moxxy.path === 'object' && typeof moxxy.path.mock === 'function') {
        moxxy.path.mock(windowsSimulator.createWindowsPathMock());
        return true;
      }
    }
    return false;
  };
}
