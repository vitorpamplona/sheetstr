const processInPool = async (items, processItem, poolSize, onProgress) => {
    let pool = {};
    let remaining = [...items]
    
    while (remaining.length) {
      let processing = remaining.splice(0, 1)
      let item = processing[0]
      pool[item] = processItem(item);
        
      if (Object.keys(pool).length > poolSize - 1) {
        try {
          const resolvedId = await Promise.race(Object.values(pool)); // wait for one Promise to finish
          delete pool[resolvedId]; // remove that Promise from the pool
        } catch (resolvedId) {
          delete pool[resolvedId]; // remove that Promise from the pool
        }
      }
  
      onProgress(items.length - remaining.length)
    }
  
    await Promise.allSettled(Object.values(pool));
  }