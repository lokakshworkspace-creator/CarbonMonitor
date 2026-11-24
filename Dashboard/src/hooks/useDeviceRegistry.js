/**
 * Every device registered to the caller's factories, grouped by factory -
 * GET /api/factories, then GET /api/factories/{id}/devices for each.
 *
 * This is the registry (what exists), not GET /devices/status (what has sent a
 * message since the gateway started), so a simulated device shows up here even
 * when nothing is currently publishing for it. Region-scoped server-side exactly
 * like the Regional Dashboard: an admin gets every factory, a regional head only
 * their own region's.
 *
 * @returns {{ groups: Array<{ factory: object, devices: object[] }>, loaded: boolean }}
 */

import { useEffect, useState } from 'react'

import { getFactoryDevices, getMyFactories } from '../services/api.js'

const EMPTY_GROUPS = []

export function useDeviceRegistry() {
  const [state, setState] = useState({ groups: EMPTY_GROUPS, loaded: false })

  useEffect(() => {
    let cancelled = false
    getMyFactories()
      .then((factories) =>
        Promise.all(
          factories.map((factory) =>
            getFactoryDevices(factory.id)
              .then((devices) => ({ factory, devices }))
              .catch(() => ({ factory, devices: [] })),
          ),
        ),
      )
      .then((groups) => {
        if (!cancelled) setState({ groups: groups.filter((g) => g.devices.length > 0), loaded: true })
      })
      .catch(() => {
        // The live-device list still works on its own; this only adds the
        // registered-but-silent devices (e.g. simulated factories).
        if (!cancelled) setState({ groups: EMPTY_GROUPS, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
