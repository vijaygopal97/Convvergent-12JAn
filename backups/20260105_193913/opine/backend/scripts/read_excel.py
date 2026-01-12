#!/usr/bin/env python3
import pandas as pd
import json
import sys

try:
    excel_path = sys.argv[1]
    df = pd.read_excel(excel_path)
    
    # Find Response ID column (case-insensitive)
    responseIdCol = None
    reasonCol = None
    
    for col in df.columns:
        col_lower = str(col).lower()
        if 'response' in col_lower and 'id' in col_lower:
            responseIdCol = col
        if 'reason' in col_lower and 'rejection' in col_lower:
            reasonCol = col
    
    if not responseIdCol:
        print(json.dumps({'error': 'Response ID column not found', 'columns': list(df.columns)}))
        sys.exit(1)
    
    if not reasonCol:
        print(json.dumps({'error': 'Reason for Rejection column not found', 'columns': list(df.columns)}))
        sys.exit(1)
    
    # Create list of response IDs and reasons
    data = []
    for idx, row in df.iterrows():
        responseId = str(row[responseIdCol]).strip() if pd.notna(row[responseIdCol]) else None
        reason = str(row[reasonCol]).strip() if pd.notna(row[reasonCol]) else None
        
        if responseId and responseId != 'nan' and responseId != 'None':
            data.append({
                'responseId': responseId,
                'reason': reason if reason and reason != 'nan' else 'Manual Rejection'
            })
    
    print(json.dumps({'success': True, 'data': data, 'total': len(data)}))
except Exception as e:
    print(json.dumps({'error': str(e), 'traceback': str(sys.exc_info())}))
    sys.exit(1)







