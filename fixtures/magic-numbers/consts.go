package consts

const Max = 5
const MinTemp = -40

func CheckThreshold(x int) bool {
	if x > 42 {
		return true
	}
	return false
}

func CheckLowerBound(x int) bool {
	return x < -273
}

func LocalScope() int {
	const localNotPackageLevel = 99
	return localNotPackageLevel
}
