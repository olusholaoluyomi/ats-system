// candidate pool for scripts/discover-companies.mjs, focused on Africa-led
// tech companies - neither the YC pool nor known-companies-pool.ts had any
// deliberate geographic representation, and both skew US/Europe-headquartered
// by construction (YC's dataset is YC's own portfolio; known-companies-pool
// was hand-picked from globally well-known western tech companies). this
// pool exists specifically to surface African fintech/healthtech/logistics/
// e-commerce/agritech startups that happen to run their hiring on
// Greenhouse/Lever/Ashby.
//
// same caveat as known-companies-pool.ts: every entry here is a GUESS at a
// company's board token, not a verified claim - discover-companies.mjs tests
// each one live and only keeps what actually resolves. many African startups
// run their hiring on ATS platforms this board doesn't integrate with yet
// (Workable, BreezyHR, Recruitee, homegrown career pages), so this pool is
// expected to have a much lower hit rate than the other two - that's fine,
// a wrong guess just 404s and gets discarded, same as everywhere else.
export interface KnownCompanyCandidate {
	name: string;
	slug: string;
}

export const AFRICA_COMPANIES_POOL: KnownCompanyCandidate[] = [
	// fintech - Nigeria
	{ name: 'Flutterwave', slug: 'flutterwave' },
	{ name: 'Paystack', slug: 'paystack' },
	{ name: 'Moniepoint', slug: 'moniepoint' },
	{ name: 'Kuda', slug: 'kuda' },
	{ name: 'Bamboo', slug: 'bamboo' },
	{ name: 'Cowrywise', slug: 'cowrywise' },
	{ name: 'PiggyVest', slug: 'piggyvest' },
	{ name: 'Carbon', slug: 'carbon' },
	{ name: 'Interswitch', slug: 'interswitch' },
	{ name: 'Trove Finance', slug: 'trovefinance' },
	{ name: 'Grey Finance', slug: 'grey' },
	{ name: 'Nomba', slug: 'nomba' },
	{ name: 'Eyowo', slug: 'eyowo' },
	{ name: 'Bento Africa', slug: 'bentoafrica' },
	{ name: 'Termii', slug: 'termii' },
	{ name: 'Okra', slug: 'okra' },
	{ name: 'Mono', slug: 'mono' },
	{ name: 'Zone', slug: 'zone' },
	{ name: 'Renmoney', slug: 'renmoney' },
	{ name: 'Prospa', slug: 'prospa' },

	// fintech - Kenya / East Africa
	{ name: 'M-KOPA', slug: 'mkopa' },
	{ name: 'Tala', slug: 'tala' },
	{ name: 'Cellulant', slug: 'cellulant' },
	{ name: 'Pezesha', slug: 'pezesha' },
	{ name: 'Chipper Cash', slug: 'chippercash' },
	{ name: 'Wave', slug: 'wave' },
	{ name: 'NALA', slug: 'nala' },
	{ name: 'Tugende', slug: 'tugende' },

	// fintech - South Africa / pan-African
	{ name: 'Yoco', slug: 'yoco' },
	{ name: 'Jumo', slug: 'jumo' },
	{ name: 'TymeBank', slug: 'tymebank' },
	{ name: 'Stitch', slug: 'stitchmoney' },
	{ name: 'Peach Payments', slug: 'peachpayments' },
	{ name: 'Ozow', slug: 'ozow' },
	{ name: 'MFS Africa', slug: 'mfsafrica' },
	{ name: 'Onafriq', slug: 'onafriq' },

	// e-commerce / logistics / delivery
	{ name: 'Jumia', slug: 'jumia' },
	{ name: 'Sendy', slug: 'sendy' },
	{ name: 'Kobo360', slug: 'kobo360' },
	{ name: 'Lori Systems', slug: 'lorisystems' },
	{ name: 'MAX.ng', slug: 'max' },
	{ name: 'Gokada', slug: 'gokada' },
	{ name: 'Sendbox', slug: 'sendbox' },
	{ name: 'Fez Delivery', slug: 'fezdelivery' },
	{ name: 'Wasoko', slug: 'wasoko' },
	{ name: 'TradeDepot', slug: 'tradedepot' },
	{ name: 'Copia Global', slug: 'copiaglobal' },
	{ name: 'Twiga Foods', slug: 'twigafoods' },

	// healthtech
	{ name: 'Reliance Health', slug: 'reliancehealth' },
	{ name: 'mPharma', slug: 'mpharma' },
	{ name: 'Field Intelligence', slug: 'fieldintelligence' },
	{ name: '54gene', slug: '54gene' },
	{ name: 'Ilara Health', slug: 'ilarahealth' },
	{ name: 'Helium Health', slug: 'heliumhealth' },
	{ name: 'LifeBank', slug: 'lifebank' },
	{ name: 'Vezeeta', slug: 'vezeeta' },

	// HR / SaaS / dev tools
	{ name: 'SeamlessHR', slug: 'seamlesshr' },
	{ name: 'Bento Engineering', slug: 'bentoengineering' },
	{ name: 'Andela', slug: 'andela' },
	{ name: 'Norebase', slug: 'norebase' },
	{ name: 'Sabi', slug: 'sabi' },
	{ name: 'Vendease', slug: 'vendease' },
	{ name: 'Workpay', slug: 'workpay' },
	{ name: 'Turaco', slug: 'turaco' },

	// agritech / energy
	{ name: 'Apollo Agriculture', slug: 'apolloagriculture' },
	{ name: 'Complete Farmer', slug: 'completefarmer' },
	{ name: 'Thrive Agric', slug: 'thriveagric' },
	{ name: 'M-KOPA Solar', slug: 'mkoposolar' },
	{ name: 'BBOXX', slug: 'bboxx' },
	{ name: 'Sun King', slug: 'sunking' },
	{ name: 'Daystar Power', slug: 'daystarpower' },

	// gaming / media / consumer
	{ name: 'Carry1st', slug: 'carry1st' },
	{ name: 'uLesson', slug: 'ulesson' },
	{ name: 'Eden Life', slug: 'edenlife' },
	{ name: 'Autochek', slug: 'autochek' },
	{ name: 'Cars45', slug: 'cars45' },

	// north Africa
	{ name: 'Fawry', slug: 'fawry' },
	{ name: 'MNT-Halan', slug: 'mnthalan' },
	{ name: 'Swvl', slug: 'swvl' },
	{ name: 'Instabug', slug: 'instabug' },
	{ name: 'Trella', slug: 'trella' }
];
