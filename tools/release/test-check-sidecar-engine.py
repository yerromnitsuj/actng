from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import pytest

path = Path(__file__).with_name("check-sidecar-engine.py")
spec = spec_from_file_location("check_sidecar_engine", path)
module = module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

def valid():
    return {
        "name": module.EXPECTED["name"],
        "version": module.EXPECTED["version"],
        "profiles": list(module.EXPECTED["profiles"]),
        "methods": [dict(value) for value in module.EXPECTED["methods"]],
        "interchange": {
            "specVersion": module.EXPECTED["interchange"]["specVersion"],
            "generator": dict(module.EXPECTED["interchange"]["generator"]),
        },
    }

def test_accepts_exact_identity(): module.verify(valid())

@pytest.mark.parametrize("field", ["name", "version"])
def test_rejects_top_level_drift(field):
    value=valid(); value[field]="drift"
    with pytest.raises(ValueError): module.verify(value)

def test_rejects_wire_drift():
    value=valid(); value["interchange"]["specVersion"]="2.0.0"
    with pytest.raises(ValueError): module.verify(value)

@pytest.mark.parametrize("field", ["profiles", "methods"])
def test_rejects_registry_order_or_content_drift(field):
    value=valid(); value[field]=list(reversed(value[field]))
    with pytest.raises(ValueError): module.verify(value)

def test_rejects_extra_or_reordered_top_level_keys():
    value=valid(); value["extra"]=True
    with pytest.raises(ValueError): module.verify(value)
    reordered={"version": value.pop("version"), **{key: item for key,item in value.items() if key != "extra"}}
    with pytest.raises(ValueError): module.verify(reordered)
