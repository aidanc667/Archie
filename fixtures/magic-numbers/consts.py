# fixtures/magic-numbers/consts.py
MAX = 5
MIN_TEMP = -40


def check_threshold(x):
    if x > 42:
        return True
    return False


def check_lower_bound(x):
    return x < -273


def local_scope():
    local_not_module_level = 99
    return local_not_module_level
