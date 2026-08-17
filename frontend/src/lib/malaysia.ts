// Mirror of backend/modules/geo/malaysia.go. The server re-validates.

export const MALAYSIA_STATES_TO_DISTRICTS: Record<string, string[]> = {
  Johor: [
    'Batu Pahat', 'Johor Bahru', 'Kluang', 'Kota Tinggi', 'Kulai',
    'Mersing', 'Muar', 'Pontian', 'Segamat', 'Tangkak',
  ],
  Kedah: [
    'Baling', 'Bandar Baharu', 'Kota Setar', 'Kuala Muda', 'Kubang Pasu',
    'Kulim', 'Langkawi', 'Padang Terap', 'Pendang', 'Pokok Sena', 'Sik', 'Yan',
  ],
  Kelantan: [
    'Bachok', 'Gua Musang', 'Jeli', 'Kota Bharu', 'Kuala Krai', 'Machang',
    'Pasir Mas', 'Pasir Puteh', 'Tanah Merah', 'Tumpat',
  ],
  Melaka: [
    'Alor Gajah', 'Jasin', 'Melaka Tengah',
  ],
  'Negeri Sembilan': [
    'Jelebu', 'Jempol', 'Kuala Pilah', 'Port Dickson', 'Rembau',
    'Seremban', 'Tampin',
  ],
  Pahang: [
    'Bentong', 'Bera', 'Cameron Highlands', 'Jerantut', 'Kuantan', 'Lipis',
    'Maran', 'Pekan', 'Raub', 'Rompin', 'Temerloh',
  ],
  Perak: [
    'Bagan Datuk', 'Batang Padang', 'Hilir Perak', 'Hulu Perak', 'Kampar',
    'Kerian', 'Kinta', 'Kuala Kangsar', 'Larut Matang dan Selama', 'Manjung',
    'Muallim', 'Perak Tengah',
  ],
  Perlis: [
    'Perlis',
  ],
  'Pulau Pinang': [
    'Barat Daya', 'Seberang Perai Selatan', 'Seberang Perai Tengah',
    'Seberang Perai Utara', 'Timur Laut',
  ],
  Sabah: [
    'Beaufort', 'Beluran', 'Kalabakan', 'Keningau', 'Kinabatangan',
    'Kota Belud', 'Kota Kinabalu', 'Kota Marudu', 'Kuala Penyu', 'Kudat',
    'Kunak', 'Lahad Datu', 'Nabawan', 'Papar', 'Penampang', 'Pitas',
    'Putatan', 'Ranau', 'Sandakan', 'Semporna', 'Sipitang', 'Tambunan',
    'Tawau', 'Telupid', 'Tenom', 'Tongod', 'Tuaran',
  ],
  Sarawak: [
    'Betong', 'Bintulu', 'Kapit', 'Kuching', 'Limbang', 'Miri', 'Mukah',
    'Samarahan', 'Sarikei', 'Serian', 'Sibu', 'Sri Aman',
  ],
  Selangor: [
    'Gombak', 'Hulu Langat', 'Hulu Selangor', 'Klang', 'Kuala Langat',
    'Kuala Selangor', 'Petaling', 'Sabak Bernam', 'Sepang',
  ],
  Terengganu: [
    'Besut', 'Dungun', 'Hulu Terengganu', 'Kemaman', 'Kuala Nerus',
    'Kuala Terengganu', 'Marang', 'Setiu',
  ],
  'Wilayah Persekutuan Kuala Lumpur': [
    'Kuala Lumpur',
  ],
  'Wilayah Persekutuan Labuan': [
    'Labuan',
  ],
  'Wilayah Persekutuan Putrajaya': [
    'Putrajaya',
  ],
};

export const MALAYSIA_STATES = Object.keys(MALAYSIA_STATES_TO_DISTRICTS).sort();

export const districtsOf = (state: string): string[] =>
  [...(MALAYSIA_STATES_TO_DISTRICTS[state] ?? [])].sort();

export const isValidStateDistrict = (state: string, district: string): boolean =>
  (MALAYSIA_STATES_TO_DISTRICTS[state] ?? []).includes(district);

const STATE_SHORT_NAMES: Record<string, string> = {
  'Wilayah Persekutuan Kuala Lumpur': 'WP Kuala Lumpur',
  'Wilayah Persekutuan Labuan': 'WP Labuan',
  'Wilayah Persekutuan Putrajaya': 'WP Putrajaya',
};

export const formatLocation = (district?: string, state?: string): string => {
  const d = district?.trim() ?? '';
  const s = state?.trim() ?? '';
  if (!s) return d;
  const shortState = STATE_SHORT_NAMES[s] ?? s;
  if (!d || d === s || d === shortState) return shortState;
  return `${d}, ${shortState}`;
};
