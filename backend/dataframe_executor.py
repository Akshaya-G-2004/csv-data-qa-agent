import ast
import operator
import pandas as pd
from typing import Any, Dict, Optional

# Allowed operators
BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.BitAnd: operator.and_,
    ast.BitOr: operator.or_,
    ast.BitXor: operator.xor,
}

UNARY_OPS = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.Invert: operator.invert,
}

COMP_OPS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}

# Strict whitelist of allowed pandas attributes, methods, and functions
ALLOWED_ATTRIBUTES = {
    # Core attributes
    "columns", "dtypes", "shape", "index",
    # Basic methods
    "groupby", "sum", "mean", "median", "count", "min", "max", "std", "var",
    "describe", "head", "tail", "sort_values", "reset_index", "rename", "round",
    "agg", "aggregate", "filter", "loc", "iloc", "dropna", "fillna", "value_counts", "drop", "replace", "idxmax", "idxmin", "nlargest", "nsmallest", "assign",
    "unique", "nunique", "astype", "isnull", "isna", "notnull", "notna", "size",
    # Merging/joining
    "merge", "join",
    # Plotting/display formatters (safe ones)
    "to_dict", "to_frame", "tolist",
    # Column specific string/dt functions
    "str", "dt", "year", "month", "day", "quarter", "contains", "lower", "upper", "extract", "split", "match", "startswith", "endswith", "strftime",
    # Math functions on Series
    "abs", "round",
}

class SafeASTInterpreter:
    def __init__(self, dfs: dict[str, pd.DataFrame]):
        self.dfs = dfs
        self.modification_occurred = None

    def evaluate(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return self.evaluate(node.body)

        elif isinstance(node, ast.Constant):
            return node.value

        elif isinstance(node, ast.Name):
            if node.id in self.dfs:
                return self.dfs[node.id]
            if node.id == "df":
                if "df1" in self.dfs:
                    return self.dfs["df1"]
                return list(self.dfs.values())[0]
            # Safe constants or standard types
            if node.id in ("True", "False", "None"):
                return {"True": True, "False": False, "None": None}[node.id]
            raise ValueError(f"Unauthorized variable or name: '{node.id}'")

        elif isinstance(node, ast.Attribute):
            base_val = self.evaluate(node.value)
            attr = node.attr
            
            # Whitelist validation
            if attr not in ALLOWED_ATTRIBUTES:
                raise ValueError(f"Pandas operation or attribute '{attr}' is not permitted.")
            
            return getattr(base_val, attr)

        elif isinstance(node, ast.Call):
            func = self.evaluate(node.func)
            
            # Evaluate arguments
            args = [self.evaluate(arg) for arg in node.args]
            kwargs = {kw.arg: self.evaluate(kw.value) for kw in node.keywords if kw.arg is not None}
            
            # Security check
            func_name = getattr(func, "__name__", str(func))
            if "apply" in func_name or "eval" in func_name or "exec" in func_name:
                raise ValueError("Operations involving lambda execution or evaluation are prohibited.")
            
            try:
                return func(*args, **kwargs)
            except Exception as e:
                raise ValueError(f"Error during pandas call '{func_name}': {str(e)}")

        elif isinstance(node, ast.Subscript):
            value = self.evaluate(node.value)
            
            slice_node = node.slice
            if isinstance(slice_node, ast.Index):
                slice_val = self.evaluate(slice_node.value)
            else:
                slice_val = self.evaluate(slice_node)

            return value[slice_val]

        elif isinstance(node, ast.Slice):
            lower = self.evaluate(node.lower) if node.lower else None
            upper = self.evaluate(node.upper) if node.upper else None
            step = self.evaluate(node.step) if node.step else None
            return slice(lower, upper, step)

        elif isinstance(node, ast.BinOp):
            left = self.evaluate(node.left)
            right = self.evaluate(node.right)
            op_type = type(node.op)
            if op_type not in BIN_OPS:
                raise ValueError(f"Unsupported binary operator: {op_type.__name__}")
            return BIN_OPS[op_type](left, right)

        elif isinstance(node, ast.UnaryOp):
            operand = self.evaluate(node.operand)
            op_type = type(node.op)
            if op_type not in UNARY_OPS:
                raise ValueError(f"Unsupported unary operator: {op_type.__name__}")
            return UNARY_OPS[op_type](operand)

        elif isinstance(node, ast.Compare):
            left = self.evaluate(node.left)
            for op, comparator in zip(node.ops, node.comparators):
                right = self.evaluate(comparator)
                op_type = type(op)
                if op_type not in COMP_OPS:
                    raise ValueError(f"Unsupported comparison operator: {op_type.__name__}")
                left = COMP_OPS[op_type](left, right)
            return left

        elif isinstance(node, ast.BoolOp):
            values = [self.evaluate(val) for val in node.values]
            if isinstance(node.op, ast.And):
                res = values[0]
                for val in values[1:]:
                    res = res & val
                return res
            elif isinstance(node.op, ast.Or):
                res = values[0]
                for val in values[1:]:
                    res = res | val
                return res
            raise ValueError(f"Unsupported boolean operator: {type(node.op).__name__}")

        elif isinstance(node, ast.List):
            return [self.evaluate(el) for el in node.elts]

        elif isinstance(node, ast.Tuple):
            return tuple(self.evaluate(el) for el in node.elts)

        elif isinstance(node, ast.Dict):
            keys = [self.evaluate(k) for k in node.keys]
            vals = [self.evaluate(v) for v in node.values]
            return dict(zip(keys, vals))

        raise ValueError(f"Forbidden syntax node: {type(node).__name__}")

    def execute_statement(self, stmt: ast.stmt) -> Any:
        """
        Executes a single top-level statement (Expression or Assignment).
        """
        if isinstance(stmt, ast.Expr):
            # Read-only evaluation
            return self.evaluate(stmt.value)

        elif isinstance(stmt, ast.Assign):
            if len(stmt.targets) != 1:
                raise ValueError("Multiple assignment targets are not supported.")
            
            target = stmt.targets[0]
            val = self.evaluate(stmt.value)

            if isinstance(target, ast.Name):
                target_id = target.id
                if target_id not in self.dfs and target_id != "df":
                    raise ValueError(f"Reassignment is only allowed for active dataframes. Invalid target: '{target_id}'")
                
                resolved_target = "df1" if target_id == "df" else target_id
                self.dfs[resolved_target] = val
                self.modification_occurred = resolved_target
                return f"Successfully modified dataset {resolved_target}"

            elif isinstance(target, ast.Subscript):
                # e.g., df1['Column'] = val
                if not isinstance(target.value, ast.Name):
                    raise ValueError("Assignment target must be a subscription on an active dataframe.")
                
                target_id = target.value.id
                resolved_target = "df1" if target_id == "df" else target_id
                if resolved_target not in self.dfs:
                    raise ValueError(f"Invalid assignment target: '{target_id}'")

                if isinstance(target.slice, ast.Index):
                    slice_val = self.evaluate(target.slice.value)
                else:
                    slice_val = self.evaluate(target.slice)

                # Mutate slice in place
                self.dfs[resolved_target][slice_val] = val
                self.modification_occurred = resolved_target
                return f"Successfully updated column '{slice_val}' in {resolved_target}"

            else:
                raise ValueError("Unsupported assignment target structure.")

        else:
            raise ValueError(f"Forbidden statement type: {type(stmt).__name__}")

def execute_pandas_query(dfs: Any, query_str: str) -> tuple[Any, bool, Optional[str]]:
    """
    Parses and executes a string query safely. Supports both queries and assignments.
    Returns a tuple of (result, modification_occurred_boolean, modified_var_name).
    """
    if isinstance(dfs, pd.DataFrame):
        dfs = {"df1": dfs, "df": dfs}

    cleaned_query = query_str.strip()
    if not (cleaned_query.startswith("df1") or cleaned_query.startswith("df2") or cleaned_query.startswith("df")):
        raise ValueError("Pandas operation must start with 'df', 'df1', or 'df2'.")

    try:
        # Parse in exec mode to support assignments
        tree = ast.parse(cleaned_query, mode="exec")
    except SyntaxError as e:
        raise ValueError(f"Invalid Python syntax: {str(e)}")

    if not tree.body:
        raise ValueError("No executable statements found.")
    
    if len(tree.body) > 1:
        raise ValueError("Only a single operation statement is permitted.")

    interpreter = SafeASTInterpreter(dfs)
    result = interpreter.execute_statement(tree.body[0])

    is_modified = interpreter.modification_occurred is not None
    modified_var = interpreter.modification_occurred

    # If it was modified, the result is the modified dataframe itself so that we can serialize it
    if is_modified:
        result = dfs[modified_var]

    return result, is_modified, modified_var
