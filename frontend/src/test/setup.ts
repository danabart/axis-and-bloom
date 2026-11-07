import { beforeEach } from 'vitest';
import { resetArchetypeRelationshipsCache } from '../app/lib/useArchetypeRelationships';

// Website 9: the archetype-order payload is cached per page; each test stubs its own.
beforeEach(() => { resetArchetypeRelationshipsCache(); });
