# fixtures/magic-numbers/consts.py
MAX = 5


def check_threshold(x):
    if x > 42:
        return True
    return False


def local_scope():
    local_not_module_level = 99
    return local_not_module_level
