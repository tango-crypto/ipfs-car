import { Blob } from "@web-std/blob"
import all from 'it-all'
// @ts-ignore
import type { ImportCandidateStream } from 'ipfs-core-types/src/utils'
export type { ImportCandidateStream }

import { MemoryBlockStore } from '../blockstore/memory'
import { pack } from './index'
import type { PackProperties } from './index'

export async function packToBlob ({ input, blockstore: userBlockstore, cidVersion, hasher, maxChunkSize, maxChildrenPerNode, wrapWithDirectory, rawLeaves }: PackProperties) {
  const blockstore = userBlockstore ? userBlockstore : new MemoryBlockStore()
  const { root, out } = await pack({
    input,
    blockstore,
    cidVersion,
    hasher,
    maxChunkSize,
    maxChildrenPerNode,
    wrapWithDirectory,
    rawLeaves
  })

  const carParts = await all(out)

  if (!userBlockstore) {
    await blockstore.close()
  }

  const car = new Blob(carParts, {
    // https://www.iana.org/assignments/media-types/application/vnd.ipld.car
    type: 'application/vnd.ipld.car',
  })

  return { root, car }
}
