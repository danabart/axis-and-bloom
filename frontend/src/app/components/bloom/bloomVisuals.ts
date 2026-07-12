// Static brand assets keyed by archetype_enum — same files Shop.tsx uses, unmodified,
// per The Bloom Part 2 spec ("reuse Camila's exact files ... only fix how they're loaded").
import bagFloral       from '../../../design/IMAGES/bags/new bags mock up/FLORAL transp.png';
import bagFruity       from '../../../design/IMAGES/bags/new bags mock up/FRUITY transp.png';
import bagBalanced     from '../../../design/IMAGES/bags/new bags mock up/BALANCED & SWEET transp.png';
import bagChocolate    from '../../../design/IMAGES/bags/new bags mock up/CHOCOLATE & NUTTY transp.png';
import bagEarthy       from '../../../design/IMAGES/bags/new bags mock up/SPICY & EARTHY transp.png';
import bagExperimental from '../../../design/IMAGES/bags/new bags mock up/EXPERIMENTAL transp.png';

import floralHero from '../../../design/IMAGES/photos/june2026/WEBCUTFloralJun01.png';
import floralSm1  from '../../../design/IMAGES/photos/june2026/WEBCUTFloralJun08.png';
import floralSm2  from '../../../design/IMAGES/photos/june2026/WEBCUTFloralJun14.png';

import fruityHero from '../../../design/IMAGES/photos/june2026/WEBCUTFruityJun01.png';
import fruitySm1  from '../../../design/IMAGES/photos/june2026/WEBCUTFruityJun05.png';
import fruitySm2  from '../../../design/IMAGES/photos/june2026/WEBCUTFruityJun06.png';

import balancedHero from '../../../design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun02.png';
import balancedSm1  from '../../../design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun04.png';
import balancedSm2  from '../../../design/IMAGES/photos/june2026/WEBCUTBalanced&SweetJun09.png';

import chocolateHero from '../../../design/IMAGES/photos/june2026/WEBCUTChocolate&NuttyJun02.png';
import chocolateSm1  from '../../../design/IMAGES/photos/june2026/WEBCUTChocolate&NuttyJun08.png';
import chocolateSm2  from '../../../design/IMAGES/photos/june2026/WEBCUTChocolate&NuttyJun10.png';

import earthyHero from '../../../design/IMAGES/photos/june2026/WEBCUTSpicy&EarthyJun04.png';
import earthySm1  from '../../../design/IMAGES/photos/june2026/WEBCUTSpicy&EarthyJun07.png';
import earthySm2  from '../../../design/IMAGES/photos/june2026/WEBCUTSpicy&EarthyJun11.png';

import expHero from '../../../design/IMAGES/photos/june2026/WEBCUTExperimentalJun2.png';
import expSm1  from '../../../design/IMAGES/photos/june2026/WEBCUTExperimentalJun7.png';
import expSm2  from '../../../design/IMAGES/photos/june2026/WEBCUTExperimentalJun10.png';

export interface ArchetypeVisual {
  num: string;
  color: string;
  hero: string; sm1: string; sm2: string;
  bag: string;
}

// Order matches Shop.tsx's ARCHETYPES array (01–06) — kept identical so customers see the
// same "which archetype is which number/color" mapping across /shop and /bloom.
export const ARCHETYPE_ORDER = ['floral', 'fruity', 'balanced_sweet', 'chocolate_nutty', 'earthy', 'experimental'] as const;

export const ARCHETYPE_VISUALS: Record<string, ArchetypeVisual> = {
  floral:          { num: '01', color: '#a34b78', hero: floralHero,     sm1: floralSm1,     sm2: floralSm2,     bag: bagFloral },
  fruity:          { num: '02', color: '#ca445f', hero: fruityHero,     sm1: fruitySm1,     sm2: fruitySm2,     bag: bagFruity },
  balanced_sweet:  { num: '03', color: '#d1ac11', hero: balancedHero,   sm1: balancedSm1,   sm2: balancedSm2,   bag: bagBalanced },
  chocolate_nutty: { num: '04', color: '#a54c2d', hero: chocolateHero, sm1: chocolateSm1,  sm2: chocolateSm2,  bag: bagChocolate },
  earthy:          { num: '05', color: '#912f2f', hero: earthyHero,     sm1: earthySm1,     sm2: earthySm2,     bag: bagEarthy },
  experimental:    { num: '06', color: '#056c7a', hero: expHero,        sm1: expSm1,        sm2: expSm2,        bag: bagExperimental },
};
