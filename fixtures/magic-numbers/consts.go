package consts

const Max = 5

func CheckThreshold(x int) bool {
	if x > 42 {
		return true
	}
	return false
}

func LocalScope() int {
	const localNotPackageLevel = 99
	return localNotPackageLevel
}
