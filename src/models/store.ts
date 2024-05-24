const localSet = async (key: string, val: any) => {
  if (chrome.storage) {
    return await chrome.storage.local.set({
      [key]: val
    })
  }
  localStorage.setItem(key, JSON.stringify(val))
}

const localGet = async (key: string): Promise<any | null> => {
  let s: any
  if (chrome.storage) {
    const ret = await chrome.storage.local.get(key)
    return ret[key]
  } else {
    s = localStorage.getItem(key)
  }

  return s && JSON.parse(s)
}


export async function set<T>(key: string, val: T) {
  await localSet(key, val)
}

export async function get<T>(key: string): Promise<T | null> {
  const ret = await localGet(key)
  return ret
}


export async function getWithDefault<T>(key: string, defaultVal: T): Promise<T> {
  const ret = await localGet(key)
  if (ret == null) {
    return defaultVal
  }

  return ret
}