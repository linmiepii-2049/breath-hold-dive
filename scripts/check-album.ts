import { albumReplaces } from '../src/save';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

assert(albumReplaces(null, 90), 'empty slot accepts a photo');
assert(albumReplaces(90, 90), 'a tie keeps the newer photo');
assert(albumReplaces(89, 90), 'a higher score replaces');
assert(!albumReplaces(90, 89), 'a lower score stays stored');

console.log('album ok');
