package geo

import (
	"sort"
	"strings"
)

var statesToDistricts = map[string][]string{
	"Johor": {
		"Batu Pahat", "Johor Bahru", "Kluang", "Kota Tinggi", "Kulai",
		"Mersing", "Muar", "Pontian", "Segamat", "Tangkak",
	},
	"Kedah": {
		"Baling", "Bandar Baharu", "Kota Setar", "Kuala Muda", "Kubang Pasu",
		"Kulim", "Langkawi", "Padang Terap", "Pendang", "Pokok Sena", "Sik", "Yan",
	},
	"Kelantan": {
		"Bachok", "Gua Musang", "Jeli", "Kota Bharu", "Kuala Krai", "Machang",
		"Pasir Mas", "Pasir Puteh", "Tanah Merah", "Tumpat",
	},
	"Melaka": {
		"Alor Gajah", "Jasin", "Melaka Tengah",
	},
	"Negeri Sembilan": {
		"Jelebu", "Jempol", "Kuala Pilah", "Port Dickson", "Rembau",
		"Seremban", "Tampin",
	},
	"Pahang": {
		"Bentong", "Bera", "Cameron Highlands", "Jerantut", "Kuantan", "Lipis",
		"Maran", "Pekan", "Raub", "Rompin", "Temerloh",
	},
	"Perak": {
		"Bagan Datuk", "Batang Padang", "Hilir Perak", "Hulu Perak", "Kampar",
		"Kerian", "Kinta", "Kuala Kangsar", "Larut Matang dan Selama", "Manjung",
		"Muallim", "Perak Tengah",
	},
	"Perlis": {
		"Perlis",
	},
	"Pulau Pinang": {
		"Barat Daya", "Seberang Perai Selatan", "Seberang Perai Tengah",
		"Seberang Perai Utara", "Timur Laut",
	},
	"Sabah": {
		"Beaufort", "Beluran", "Kalabakan", "Keningau", "Kinabatangan",
		"Kota Belud", "Kota Kinabalu", "Kota Marudu", "Kuala Penyu", "Kudat",
		"Kunak", "Lahad Datu", "Nabawan", "Papar", "Penampang", "Pitas",
		"Putatan", "Ranau", "Sandakan", "Semporna", "Sipitang", "Tambunan",
		"Tawau", "Telupid", "Tenom", "Tongod", "Tuaran",
	},
	"Sarawak": {
		"Betong", "Bintulu", "Kapit", "Kuching", "Limbang", "Miri", "Mukah",
		"Samarahan", "Sarikei", "Serian", "Sibu", "Sri Aman",
	},
	"Selangor": {
		"Gombak", "Hulu Langat", "Hulu Selangor", "Klang", "Kuala Langat",
		"Kuala Selangor", "Petaling", "Sabak Bernam", "Sepang",
	},
	"Terengganu": {
		"Besut", "Dungun", "Hulu Terengganu", "Kemaman", "Kuala Nerus",
		"Kuala Terengganu", "Marang", "Setiu",
	},
	"Wilayah Persekutuan Kuala Lumpur": {
		"Kuala Lumpur",
	},
	"Wilayah Persekutuan Labuan": {
		"Labuan",
	},
	"Wilayah Persekutuan Putrajaya": {
		"Putrajaya",
	},
}

const (
	MaxStateLen    = 50
	MaxDistrictLen = 100
)

func States() []string {
	states := make([]string, 0, len(statesToDistricts))
	for state := range statesToDistricts {
		states = append(states, state)
	}
	sort.Strings(states)
	return states
}

func Districts(state string) []string {
	canonical, ok := canonicalState(state)
	if !ok {
		return nil
	}
	districts := append([]string(nil), statesToDistricts[canonical]...)
	sort.Strings(districts)
	return districts
}

func canonicalState(state string) (string, bool) {
	trimmed := strings.TrimSpace(state)
	for known := range statesToDistricts {
		if strings.EqualFold(known, trimmed) {
			return known, true
		}
	}
	return "", false
}

// Resolve returns the canonical spelling of a state/district pair.
func Resolve(state, district string) (string, string, bool) {
	canonicalState, ok := canonicalState(state)
	if !ok {
		return "", "", false
	}
	trimmed := strings.TrimSpace(district)
	for _, known := range statesToDistricts[canonicalState] {
		if strings.EqualFold(known, trimmed) {
			return canonicalState, known, true
		}
	}
	return "", "", false
}

func IsValid(state, district string) bool {
	_, _, ok := Resolve(state, district)
	return ok
}
